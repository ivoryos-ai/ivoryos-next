import inspect
import types
import typing
import ast
import collections
import collections.abc as _abc
import json
from typing import get_origin, get_args

# A leaf that an optimizer can actually treat as an objective. bool is a subclass of int in
# Python but is never a numerical objective, so it's excluded explicitly.
NUMERIC_TYPE_NAMES = {"int", "float"}

# How deep extract_type_info will expand nested dataclass/Pydantic fields. Without a cap a
# self-referencing model (`parent: Optional[Node]`) recurses until the stack blows.
MAX_OBJECT_DEPTH = 6


def _is_numeric_annotation(annotation):
    if isinstance(annotation, type):
        return issubclass(annotation, (int, float)) and not issubclass(annotation, bool)
    # Under PEP 563 the annotation may still be the string "float" — the name is all we have.
    return isinstance(annotation, str) and annotation.strip() in NUMERIC_TYPE_NAMES


def _is_union(annotation) -> bool:
    """`Optional[X]`, `Union[A, B]` or `A | B`. One kind of object since Python 3.14
    (typing.Union is types.UnionType); before it, typing's form and the `|` form were two."""
    return get_origin(annotation) is typing.Union or isinstance(annotation, getattr(types, "UnionType", ()))


def _holds_union(annotation) -> bool:
    for arg in get_args(annotation):
        inner = arg if isinstance(arg, (list, tuple)) else [arg]
        if any(_is_union(a) or _holds_union(a) for a in inner):
            return True
    return False


# A dict, by its origin. `dict`, `typing.Dict`, `Mapping` and `MutableMapping` (typing's and
# collections.abc's share an origin), `OrderedDict`, `defaultdict`.
_MAPPING_ORIGINS = (dict, _abc.Mapping, _abc.MutableMapping, collections.OrderedDict, collections.defaultdict)
# A list, by its origin. `str` and `bytes` are Sequences to Python and are not here: text is text.
_SEQUENCE_ORIGINS = (list, tuple, set, frozenset, _abc.Sequence, _abc.MutableSequence, _abc.Set,
                     _abc.MutableSet, _abc.Iterable, _abc.Collection, collections.deque)


def _container_shape(annotation):
    """What a dict or list annotation holds: ("mapping", key, value), ("list", item, fixed), or
    None for anything else. The same as the edge's (edge_server/ivoryos_edge/introspection.py),
    so the schema the Hub stores says what a running deck says.

    `Dict[str, float]`, `dict[str, float]`, `Mapping[str, int]` and a bare `dict` are mappings
    (`inspect.Parameter.empty` where the annotation says nothing about the key or the value);
    `List[float]`, `Sequence[str]`, `Set[int]`, `Tuple[int, ...]` and a bare `list`, `tuple` or
    `set` are lists of one item type; `Tuple[int, str]` is a list of a fixed length, `fixed`
    holding one annotation per place. A class of the driver's own that subclasses dict or list
    counts as one. A dataclass, a model, an enum and a str are none of these.
    """
    origin = get_origin(annotation)
    if origin is None:
        if isinstance(annotation, type) and not isinstance(annotation, types.GenericAlias):
            origin = annotation
        else:
            return None
    if not isinstance(origin, type):
        return None
    args = get_args(annotation)
    empty = inspect.Parameter.empty
    if origin in _MAPPING_ORIGINS or issubclass(origin, dict):
        key, value = (args + (empty, empty))[:2] if len(args) == 2 else (empty, empty)
        return ("mapping", key, value)
    if origin in _SEQUENCE_ORIGINS or issubclass(origin, (list, tuple, set, frozenset)):
        if origin is tuple:
            if len(args) == 2 and args[1] is Ellipsis:
                return ("list", args[0], None)
            if args and args != ((),):
                return ("list", empty, list(args))
            return ("list", empty, None)
        return ("list", args[0] if len(args) == 1 else empty, None)
    return None


def _describe_container(shape, _depth, _seen):
    """The schema keys for a dict or list parameter: what it is, and what its keys, values or
    items are, each described as a parameter is (so a `Dict[str, Color]` value lists the enum's
    choices, and a `List[float]` item is numeric). `required` means nothing inside a container
    and is left off."""
    def inner(annotation):
        if annotation is inspect.Parameter.empty:
            return None
        info = extract_type_info(annotation, inspect.Parameter.empty, _depth + 1, _seen)
        info.pop("required", None)
        return info

    kind = shape[0]
    if kind == "mapping":
        out = {"is_mapping": True}
        key, value = inner(shape[1]), inner(shape[2])
        if key is not None:
            out["key_type"] = key
        if value is not None:
            out["value_type"] = value
        return out
    out = {"is_list": True}
    if shape[2] is not None:
        out["items"] = [inner(a) or {"type": "Any"} for a in shape[2]]
    else:
        item = inner(shape[1])
        if item is not None:
            out["item_type"] = item
    return out


def _argument_name(arg) -> str:
    if isinstance(arg, (list, tuple)):  # Callable[[int, str], ...]'s parameters
        return f"[{', '.join(_argument_name(a) for a in arg)}]"
    if arg is Ellipsis:
        return "..."
    return type_name(arg)


def type_name(annotation) -> str:
    """How a type reads in a schema, the same on every Python version.

    Python 3.14 made `Optional[float]` and `float | None` one object, printed as the latter;
    before it each printed as written. So a union is written one way here, typing's
    (`Optional[X]`, `Union[A, B]`, with NoneType named when there are several), however the
    driver wrote it: what the Hub's driver schemas, the forms and the tour (frontend
    tour/sim.ts baseType) read. A plain class reads as its name, not "<class 'float'>"; anything
    else as str() writes it without `typing.` or `typing_extensions.`, a union inside it
    (`List[Optional[float]]`) written as above. `list[int]` is not a class here, though Python 3.10 says it is.
    """
    if _is_union(annotation):
        args = get_args(annotation)
        members = [a for a in args if a is not type(None)]
        if len(members) == 1 and len(args) == 2:
            return f"Optional[{type_name(members[0])}]"
        return f"Union[{', '.join(type_name(a) for a in args)}]"
    if isinstance(annotation, type) and not isinstance(annotation, types.GenericAlias):
        return annotation.__name__
    # `typing_extensions.` too: what a driver imports from there on an older Python (Self,
    # Literal) is in typing on a newer one.
    text = str(annotation).replace("typing_extensions.", "").replace("typing.", "")
    if not get_args(annotation) or not _holds_union(annotation):
        return text
    return f"{text.split('[', 1)[0]}[{', '.join(_argument_name(a) for a in get_args(annotation))}]"


def extract_type_info(annotation, default=inspect.Parameter.empty, _depth=0, _seen=None):
    param_type = "Any"
    options = None
    is_object = False
    is_numeric = False
    fields = {}
    nullable = False
    container = {}
    _seen = set() if _seen is None else _seen
    # `Annotated[float, Unit("mL")]`: the type is what sits underneath, and what the markers say
    # is added at the end. A method's parameters have theirs read by _resolve_markers (the hints
    # it works from are stripped of Annotated); this is for everywhere else an annotation can sit
    # -- a dataclass field, a tuple element of a return -- so a unit on a result's field reaches
    # its return path.
    annotation, markers = _split_annotated(annotation)

    if annotation != inspect.Parameter.empty:
        # A plain class by its name rather than "<class 'float'>" (cast_value/cast_arguments
        # re-introspect the real annotation, never this string), and a union the same way on
        # every Python version: see type_name.
        param_type = type_name(annotation)

        is_numeric = _is_numeric_annotation(annotation)

        # Check for Enum
        import enum
        if isinstance(annotation, type) and issubclass(annotation, enum.Enum):
            options = [e.value for e in annotation]
            param_type = annotation.__name__

        # Check for Literal
        try:
            # Need to handle Literal which might be typing.Literal or typing_extensions.Literal
            if getattr(get_origin(annotation), '__name__', '') == 'Literal' or get_origin(annotation) is getattr(typing, 'Literal', None):
                options = list(get_args(annotation))
                param_type = "Literal"
        except Exception:
            pass

        # Check for bool
        if annotation is bool:
            options = ["True", "False"]

        # A dict or a list: said apart, with what its keys, values or items are, so a form can
        # take one as text and check it. The type's name alone (`Dict[str, float]`) told the
        # pages nothing a substring test could trust: "int" in "Dict[str, int]" made it a number box.
        shape = _container_shape(annotation)
        if shape is not None:
            container = _describe_container(shape, _depth, _seen | {id(annotation)})

        # A model that contains itself (directly or through a cycle) would otherwise recurse
        # forever; expanding it once and reporting the repeat as a plain leaf is enough for
        # both a form and a return-path list.
        recursion_ok = _depth < MAX_OBJECT_DEPTH and id(annotation) not in _seen
        child_seen = _seen | {id(annotation)}

        # Check for Dataclass
        import dataclasses
        if dataclasses.is_dataclass(annotation):
            is_object = True
            param_type = getattr(annotation, '__name__', 'Dataclass')
            if recursion_ok:
                for f in dataclasses.fields(annotation):
                    f_default = f.default if f.default != dataclasses.MISSING else inspect.Parameter.empty
                    if f.default_factory != dataclasses.MISSING:
                        try:
                            f_default = f.default_factory()
                        except Exception:
                            pass
                    fields[f.name] = extract_type_info(_resolve_field_type(annotation, f.name, f.type),
                                                       f_default, _depth + 1, child_seen)

        # Check for Pydantic
        else:
            try:
                from pydantic import BaseModel
                if isinstance(annotation, type) and issubclass(annotation, BaseModel):
                    is_object = True
                    param_type = getattr(annotation, '__name__', 'BaseModel')
                    if recursion_ok and hasattr(annotation, 'model_fields'):
                        for f_name, f_info in annotation.model_fields.items():
                            f_default = getattr(f_info, 'default', inspect.Parameter.empty)
                            # Handle Pydantic v2 ...
                            if f_default.__class__.__name__ == 'PydanticUndefinedType' or f_default == Ellipsis:
                                f_default = inspect.Parameter.empty
                            fields[f_name] = extract_type_info(f_info.annotation, f_default, _depth + 1, child_seen)
                            # Pydantic strips Annotated from `annotation` and keeps the metadata
                            # beside it, so a field's markers are read from there.
                            for marker in getattr(f_info, "metadata", None) or ():
                                if callable(getattr(marker, "ivoryos_schema", None)):
                                    fields[f_name].update(marker.ivoryos_schema())
                    elif recursion_ok and hasattr(annotation, '__fields__'):
                        for f_name, f_info in annotation.__fields__.items():
                            f_default = f_info.default if f_info.required == False else inspect.Parameter.empty
                            fields[f_name] = extract_type_info(f_info.type_, f_default, _depth + 1, child_seen)
            except ImportError:
                pass

        # Optional[X] / Union[X, None] is still just X as far as a form (or an objective) is
        # concerned — without unwrapping it, an optional enum loses its choices, an optional
        # dataclass loses its fields, and an Optional[float] return stops looking numeric.
        # A union only: this used to unwrap any generic of one argument, so `List[float]` was
        # numeric, `List[Color]` one dropdown and `List[Point]` one object's fields.
        if options is None and not is_object and _is_union(annotation):
            try:
                all_args = get_args(annotation)
                args = [a for a in all_args if a is not type(None)]
                if len(args) == 1:
                    # A None arm was stripped: the parameter accepts None, and a validator must
                    # not call a deliberate None "missing" or "not a number".
                    nullable = len(args) < len(all_args)
                    inner = extract_type_info(args[0], inspect.Parameter.empty, _depth, _seen)
                    if inner.get("options") is not None:
                        options = inner["options"]
                        param_type = inner["type"]
                    elif inner.get("is_object"):
                        is_object = True
                        fields = inner.get("fields", {})
                        param_type = inner["type"]
                    elif inner.get("numeric"):
                        is_numeric = True
                    elif inner.get("is_mapping") or inner.get("is_list"):
                        # `Optional[Dict[str, float]]` is a dict a form can leave as None.
                        container = {k: inner[k] for k in ("is_mapping", "is_list", "key_type", "value_type", "item_type", "items") if k in inner}
                    # `Optional[Annotated[float, Unit("mL")]]` keeps the Annotated inside the
                    # Union: its markers still apply, and the type reads "Optional[float]"
                    # rather than the Annotated repr.
                    inner_markers = _split_annotated(args[0])[1]
                    if inner_markers:
                        markers = markers + inner_markers
                        param_type = f"Optional[{inner['type']}]" if nullable else inner["type"]
            except Exception:
                pass

    param_data = {
        "type": param_type,
        "required": default == inspect.Parameter.empty
    }
    if nullable:
        param_data["optional"] = True
    if options is not None:
        param_data["options"] = options
    if is_object:
        param_data["is_object"] = True
        param_data["fields"] = fields
    if is_numeric:
        # Marks a leaf an optimizer can use as an objective — see build_return_paths.
        param_data["numeric"] = True
    param_data.update(container)

    if default != inspect.Parameter.empty:
        import enum
        if isinstance(default, enum.Enum):
            param_data["default"] = default.value
        else:
            param_data["default"] = default

    for marker in markers:
        param_data.update(marker.ivoryos_schema())

    return param_data


def _unwrap_requiredness(annotation):
    """`NotRequired[bool]` / `Required[int]` describe whether a TypedDict key must be present,
    not what type it is. Required-ness comes from the TypedDict's own key sets, so strip the
    wrapper and keep the type underneath — without this a declared option renders as
    "NotRequired[bool]" free text instead of a True/False dropdown."""
    if getattr(get_origin(annotation), "__name__", "") in ("NotRequired", "Required"):
        args = get_args(annotation)
        if args:
            return args[0]
    return annotation


def _declared_kwargs_fields(annotation):
    """The keyword arguments a `**kwargs` annotation *declares*, as {name: (annotation, required)}.

    PEP 692 lets a driver say exactly what its `**kwargs` accepts:

        class MeasureOptions(TypedDict):
            slit_um: int
            lamp: NotRequired[bool]

        def measure(self, wavelength_nm: float, **options: Unpack[MeasureOptions]): ...

    That is the difference between "arguments this schema cannot enumerate" and "arguments
    nobody bothered to write down". When they are declared, each one becomes an ordinary listed
    parameter — typed field, dropdown, default, casting, and a real typo check — instead of a
    free-text row the scientist has to know the spelling of. Returns None when the annotation
    says nothing, which is the ordinary `**kwargs` case.

    A bare `**options: MeasureOptions` is read the same way. It is not what PEP 692 specifies
    (that form means "every value is a MeasureOptions"), but it is a common enough slip that
    guessing the useful reading beats rendering nothing.
    """
    if getattr(get_origin(annotation), "__name__", "") == "Unpack":
        args = get_args(annotation)
        annotation = args[0] if args else None

    # Detected by the key sets a TypedDict always carries rather than typing.is_typeddict(),
    # which does not recognise a typing_extensions TypedDict on every runtime.
    required_keys = getattr(annotation, "__required_keys__", None)
    if required_keys is None or not hasattr(annotation, "__annotations__"):
        return None

    try:
        # Annotated kept: extract_type_info reads its markers (a unit on a declared option).
        hints = typing.get_type_hints(annotation, include_extras=True)
    except Exception:
        hints = dict(getattr(annotation, "__annotations__", {}))

    return {
        key: (_unwrap_requiredness(hint), key in required_keys)
        for key, hint in hints.items()
    }


def _resolve_field_type(owner, field_name, declared):
    """dataclasses.fields() hands back the *declared* annotation, which under PEP 563 is a
    string. Resolve it against the owning class where possible so nested dataclasses/enums
    keep expanding instead of degrading to a free-text leaf."""
    if not isinstance(declared, str):
        return declared
    try:
        # Annotated kept, so a field's markers (a unit) are read by extract_type_info.
        return typing.get_type_hints(owner, include_extras=True).get(field_name, declared)
    except Exception:
        return declared


def build_return_paths(annotation, info=None):
    """Flatten a return annotation into an ordered list of addressable leaves:

        [{"path": "yield_pct", "type": "float", "numeric": True},
         {"path": "metrics.purity", "type": "float", "numeric": True},
         {"path": "sample_id", "type": "str", "numeric": False}]

    A method returning a complex dataclass/Pydantic model rarely returns one number, but an
    optimizer can only take numbers — these paths are what lets the UI bind a named variable
    to one *field* of a structured result (and grey out the non-numeric ones) instead of
    forcing the whole object through a single return variable. `path` is dotted and is
    resolved against the serialized result by resolve_output_path at run time; a scalar
    return yields a single entry with an empty path, meaning "the result itself".
    """
    if annotation is inspect.Parameter.empty or annotation is None:
        return []

    # A fixed-length tuple return (`-> tuple[float, float]`) is addressed by index. Tuple[X, ...]
    # is variadic — there's no fixed leaf to point at, so it stays a single opaque result.
    try:
        origin = get_origin(annotation)
        args = get_args(annotation)
        if origin in (tuple, typing.Tuple) and args and Ellipsis not in args:
            paths = []
            for i, arg in enumerate(args):
                paths.extend(_flatten_info(extract_type_info(arg), str(i)))
            return paths
    except Exception:
        pass

    return _flatten_info(info if info is not None else extract_type_info(annotation), "")


def _flatten_info(info, prefix):
    if not info:
        return []
    fields = info.get("fields") if info.get("is_object") else None
    if fields:
        paths = []
        for name, child in fields.items():
            paths.extend(_flatten_info(child, f"{prefix}.{name}" if prefix else name))
        return paths
    leaf = {
        "path": prefix,
        "type": info.get("type", "Any"),
        "numeric": bool(info.get("numeric")),
    }
    if info.get("unit"):
        # `-> Annotated[float, Unit("°C")]`, or a unit on a dataclass field: the Designer's
        # Outputs panel and the Optimize page's objectives say what a saved value is in.
        leaf["unit"] = info["unit"]
    return [leaf]


_MISSING = object()


def resolve_output_path(value, path):
    """Walk a dotted return path (as produced by build_return_paths) against an actual result.

    Works on the serialized form (dicts/lists) and on the live object (attributes), so it
    doesn't matter which one the caller has. Returns the _MISSING sentinel rather than None
    when the path doesn't exist, since None is a legitimate field value.
    """
    if not path:
        return value
    current = value
    for segment in str(path).split("."):
        if isinstance(current, dict):
            if segment not in current:
                return _MISSING
            current = current[segment]
        elif isinstance(current, (list, tuple)) and segment.lstrip("-").isdigit():
            index = int(segment)
            if index >= len(current) or index < -len(current):
                return _MISSING
            current = current[index]
        elif hasattr(current, segment):
            current = getattr(current, segment)
        else:
            return _MISSING
    return current

PROPERTY_SETTER_SUFFIX = "_(setter)"


def _resolve_hints(func, extras=False):
    """Annotations as real objects where possible.

    Under PEP 563 every annotation arrives as a string, which would make extract_type_info's
    Enum/bool/dataclass checks fall through and turn a dropdown into a free-text box.
    """
    try:
        # `extras=True` keeps Annotated (inside a tuple or an Optional too), for what
        # extract_type_info reads markers from; the default strips it for the type checks.
        return typing.get_type_hints(func, include_extras=extras)
    except Exception:
        return {}


def _resolve_markers(func):
    """What a driver says about a parameter beyond its type: `Annotated[str, Labware("plate")]`.

    Any annotation metadata with an `ivoryos_schema()` method contributes its keys to that
    parameter's entry, as in edge_server/ivoryos_edge/introspection.py (the same function): which
    argument names a labware, which picks wells on it, which takes one value per well. Class level
    has no worktable, so a labware argument gets no `options` here; a running deck fills them in.
    """
    try:
        hints = typing.get_type_hints(func, include_extras=True)
    except Exception:
        return {}
    out = {}
    for name, hint in hints.items():
        # Python before 3.11 wraps `Annotated[Optional[str], ...] = None` in another Optional, so
        # the Annotated can sit one Union down.
        candidates = [hint] + (list(get_args(hint)) if get_origin(hint) is typing.Union else [])
        for candidate in candidates:
            found = _split_annotated(candidate)[1]
            if found:
                out[name] = found
                break
    return out


def _split_annotated(annotation):
    """(the type underneath, its markers) for an `Annotated[...]`; (annotation, []) for anything
    else. Only metadata with an `ivoryos_schema()` method is a marker: Annotated also carries
    docstrings and other libraries' metadata, which are left alone."""
    if get_origin(annotation) is typing.Annotated:
        args = get_args(annotation)
        return args[0], [m for m in args[1:] if callable(getattr(m, "ivoryos_schema", None))]
    return annotation, []


# Modelling frameworks put properties on their own base class -- pydantic's `model_extra` and
# `model_fields_set`, for instance. They describe the library, not the instrument, and nobody is
# going to drive one from a workflow, so they don't belong in the schema.
FRAMEWORK_PROPERTY_PACKAGES = ("pydantic",)


def _defining_class(cls, name):
    """The class in `cls`'s MRO that actually defines `name`."""
    for base in getattr(cls, "__mro__", (cls,)):
        if name in vars(base):
            return base
    return None


def _iter_class_properties(cls):
    """Yield (name, property) for every public property on `cls`.

    Properties have to be found on the *class*: looking one up on an instance runs fget, so
    on a real driver merely building the schema would go and talk to the hardware.
    """
    for name, attr in inspect.getmembers(cls, lambda x: isinstance(x, property)):
        if name.startswith("_"):
            continue
        owner = _defining_class(cls, name)
        if owner is not None and getattr(owner, "__module__", "").split(".")[0] in FRAMEWORK_PROPERTY_PACKAGES:
            continue
        yield name, attr


def _setter_value_annotation(prop):
    """The type a property's setter accepts: its own parameter annotation when it has one,
    otherwise whatever the getter promises to return."""
    if prop.fset is not None:
        try:
            hints = _resolve_hints(prop.fset)
            params = [p for n, p in inspect.signature(prop.fset).parameters.items() if n != "self"]
            if params:
                annotation = hints.get(params[0].name, params[0].annotation)
                if annotation is not inspect.Parameter.empty:
                    return annotation
        except (TypeError, ValueError):
            pass
    if prop.fget is not None:
        try:
            annotation = _resolve_hints(prop.fget).get("return", inspect.signature(prop.fget).return_annotation)
            if annotation is not inspect.Signature.empty:
                return annotation
        except (TypeError, ValueError):
            pass
    return inspect.Parameter.empty


def _setter_value_markers(prop):
    """The markers on a setter's value (`Annotated[int, Unit("rpm")]`), from the same two places
    _setter_value_annotation reads the type: the setter's own parameter, else the getter's return."""
    if prop.fset is not None:
        try:
            params = [n for n in inspect.signature(prop.fset).parameters if n != "self"]
            if params:
                found = _resolve_markers(prop.fset).get(params[0])
                if found:
                    return found
        except (TypeError, ValueError):
            pass
    if prop.fget is not None:
        return _resolve_markers(prop.fget).get("return", [])
    return []


def describe_property(name, prop):
    """Expand one `@property` into the schema entries a workflow can actually use: a
    zero-argument getter under the property's own name, and — when the property is writable —
    a one-argument setter under "<name>_(setter)".

    A property is an attribute in Python but a *step* in a workflow: plenty of drivers expose
    `pump.speed = 5` as the only way to set a speed, so dropping properties from the schema
    (which is what inspecting only callables did) made those drivers half-unusable. The
    "_(setter)" suffix is the same convention the original ivoryos designer uses, so workflows
    stay readable across both.
    """
    entries = {}
    docstring = inspect.getdoc(prop) or ""

    if prop.fget is not None:
        return_type = "Any"
        return_info = None
        try:
            annotation = _resolve_hints(prop.fget).get("return", inspect.signature(prop.fget).return_annotation)
        except (TypeError, ValueError):
            annotation = inspect.Signature.empty
        return_paths = []
        if annotation is not inspect.Signature.empty:
            return_type = type_name(annotation)
            # From the hint with its Annotated kept (`-> Annotated[float, Unit("°C")]`), as for a
            # method's return; the type's text above is from the stripped one.
            rich = _resolve_hints(prop.fget, extras=True).get("return", annotation)
            return_info = extract_type_info(rich)
            # A property getter is a step like any other, so a property typed as a dataclass
            # gets the same per-field pointers a method returning one would.
            if return_type not in ("None", "NoneType"):
                return_paths = build_return_paths(rich, return_info)
        entries[name] = {
            "description": docstring,
            "parameters": {},
            "return_type": return_type,
            "return_info": return_info,
            "return_paths": return_paths,
            "is_coroutine": False,
            "is_property": True,
            "property_access": "get",
            "property_name": name,
            "has_setter": prop.fset is not None,
        }

    if prop.fset is not None:
        value_info = extract_type_info(_setter_value_annotation(prop))
        for marker in _setter_value_markers(prop):
            value_info.update(marker.ivoryos_schema())
        value_info["required"] = True
        setter_doc = inspect.getdoc(prop.fset)
        if not setter_doc:
            setter_doc = f"Set {name}." if not docstring else f"Set {name}. {docstring}"
        entries[name + PROPERTY_SETTER_SUFFIX] = {
            "description": setter_doc,
            "parameters": {"value": value_info},
            "return_type": "None",
            "return_info": extract_type_info(type(None)),
            "return_paths": [],
            "is_coroutine": False,
            "is_property": True,
            "property_access": "set",
            "property_name": name,
            "has_setter": True,
        }

    return entries


def _unwrapped_for_description(method, name):
    """The function a signature-losing decorator is hiding, or None.

    `functools.wraps` exists to prevent this and is forgotten constantly — in lab code and in
    vendor SDKs alike, where a method is wrapped for retries, a device lock, unit conversion or
    logging. What introspection is handed then is the *wrapper*: `(*args, **kwargs)` and no
    docstring. So the deck publishes "no parameters, accepts anything" for a method that really
    takes two named ones, offers a free-text kwargs editor for it, and every argument typed
    there comes back as "unexpected keyword argument" from the function underneath — an error
    about a signature the operator was never shown.

    The recovery is a guess, so it is kept narrow: the signature must be exactly
    `(*args, **kwargs)` (the forwarding shape and nothing else), there must be no `__wrapped__`
    (with one, `inspect.signature` has already followed it), and the closure must hold exactly
    one function whose `__name__` is the name this method is published under. Two decorators
    deep the inner name is the other wrapper's, so the guess is refused rather than risked.

    The recovered function is only ever *described*. Calls still go through the wrapper, which
    is there to do something.
    """
    if hasattr(method, "__wrapped__"):
        return None
    try:
        kinds = [p.kind for p in inspect.signature(method).parameters.values()]
    except (TypeError, ValueError):
        return None
    if kinds != [inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD]:
        return None

    matches = []
    for cell in getattr(getattr(method, "__func__", method), "__closure__", None) or ():
        try:
            content = cell.cell_contents
        except ValueError:  # an empty cell, in a recursive closure
            continue
        # Other cells are fine — a decorator closes over its retry count too. It is the single
        # same-named function that identifies the thing being wrapped.
        if inspect.isfunction(content) and getattr(content, "__name__", None) == name:
            matches.append(content)
    return matches[0] if len(matches) == 1 else None


def inspect_class(cls):
    """
    Inspects a Python class and returns a JSON-serializable 
    schema of its available methods, their arguments, and return types.
    """
    schema = {}

    # Properties become getter/setter entries — a driver that exposes `pump.speed = 5` has no
    # callable for it at all, so inspecting only callables dropped that capability entirely.
    property_names = set()
    for name, prop in _iter_class_properties(cls):
        property_names.add(name)
        try:
            schema.update(describe_property(name, prop))
        except Exception as e:
            print(f"Failed to inspect property {name} of class {cls.__name__}: {e}")

    # Get all callable methods that don't start with '_' (private)
    for name, method in inspect.getmembers(cls, predicate=callable):
        if name.startswith("_") or name in property_names:
            continue
            
        try:
            # A decorator that forgot functools.wraps hands us its own (*args, **kwargs) instead
            # of the method's signature — describe what it hides where that is recoverable.
            described = _unwrapped_for_description(method, name) or method
            docstring = inspect.getdoc(described)
            try:
                sig = inspect.signature(described)
            except (TypeError, ValueError):
                # A compiled entry point (a ctypes/pybind11 binding, a builtin) has no signature
                # to read, and dropping it hid a capability the class plainly exposes.
                # "Parameters unknown" is what accepts_kwargs already means downstream: nothing
                # listed, and nothing the caller sends reported as a typo.
                schema[name] = {
                    "description": docstring or "",
                    "parameters": {},
                    "return_type": "Any",
                    "return_info": None,
                    "return_paths": [],
                    "accepts_kwargs": True,
                    # Distinct from a genuine **kwargs, which is a promise the signature makes.
                    # Here nothing was read: the arguments may be keyword-able, or the method may
                    # be a C function that takes positional arguments only — `min(x=1)` reports
                    # "expected at least 1 argument, got 0" however much the caller typed in —
                    # and this deck has no way to send positional arguments. The UI says so
                    # rather than presenting the same confident row editor a **kwargs gets.
                    "signature_unavailable": True,
                    "is_coroutine": inspect.iscoroutinefunction(method),
                }
                continue

            # Under PEP 563 (`from __future__ import annotations`, increasingly common) every
            # annotation arrives as a *string*, so the Enum, bool and dataclass checks below all
            # silently fail and a dropdown degrades into a free-text box. Resolve the real objects
            # first where we can; if a forward reference cannot be resolved, fall back to the raw
            # annotations rather than losing the method.
            hints = _resolve_hints(described)
            markers = _resolve_markers(described)

            params = {}
            # A **kwargs method takes arguments this schema cannot enumerate, so anything not
            # listed is legitimate rather than a typo — recorded here for validation to relax.
            accepts_kwargs = False
            for param_name, param in sig.parameters.items():
                if param_name == "self":
                    continue
                # A variadic parameter is never required — that is what * and ** mean, whatever
                # it happens to be called. `required` here is "has no default", and a variadic
                # has no default to have, so the old code read it as required and a form then
                # offered to fill it. Filling it is an error rather than a no-op: a
                # `def move(self, *positions)` called as move(positions=[1, 2]) raises
                # TypeError, and a `**options` method quietly receives a key called "options".
                # Neither is an argument a caller can name, so neither belongs in the schema; a
                # driver that wraps everything in ** shows no parameters and is called with
                # none, which is exactly what works. Keyed on kind, never on the name — the
                # conventional args/kwargs spelling is incidental.
                if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                    if param.kind is inspect.Parameter.VAR_KEYWORD:
                        # ...unless the driver declared what they are (PEP 692). Then they are
                        # ordinary parameters and the form can show them properly — see
                        # _declared_kwargs_fields. accepts_kwargs stays false in that case: the
                        # set is known, so an argument outside it is a typo again.
                        declared = _declared_kwargs_fields(hints.get(param_name, param.annotation))
                        if declared:
                            for key, (key_annotation, key_required) in declared.items():
                                info = extract_type_info(key_annotation)
                                # A TypedDict key carries no value to default to; whether it may
                                # be omitted is what its key sets say, not what extract_type_info
                                # infers from an absent default.
                                info["required"] = key_required
                                params.setdefault(key, info)
                        else:
                            accepts_kwargs = True
                    continue
                annotation = hints.get(param_name, param.annotation)
                params[param_name] = extract_type_info(annotation, param.default)
                for marker in markers.get(param_name, ()):
                    params[param_name].update(marker.ivoryos_schema())
                if param.kind is inspect.Parameter.POSITIONAL_ONLY:
                    # Unlike a variadic, this one *is* an argument the caller supplies — it just
                    # cannot be supplied by name, and everything downstream calls with keywords
                    # only. Marked rather than dropped: edge_server's resolve_callable binds it
                    # positionally at run time and the Python preview renders it without a
                    # keyword. Common in wrapped C drivers — zlib.crc32 is `(data, value=0, /)`.
                    params[param_name]["positional"] = True
                
            return_type = "Any"
            return_info = None
            return_paths = []
            if sig.return_annotation != inspect.Signature.empty:
                ret = hints.get("return", sig.return_annotation)
                return_type = type_name(ret)
                # Described from the hint with its Annotated kept -- `-> Annotated[float,
                # Unit("g")]`, or a unit on one element of a tuple -- so the markers reach
                # return_info and every return path. The type's text above is from the stripped
                # hint, so it still reads "float".
                rich_ret = _resolve_hints(described, extras=True).get("return", ret)
                return_info = extract_type_info(rich_ret)
                # Addressable leaves of a structured return — see build_return_paths.
                if return_type not in ("None", "NoneType"):
                    return_paths = build_return_paths(rich_ret, return_info)
                
            schema[name] = {
                "description": docstring or "",
                "parameters": params,
                "return_type": return_type,
                "return_info": return_info,
                "return_paths": return_paths,
                "accepts_kwargs": accepts_kwargs,
                "is_coroutine": inspect.iscoroutinefunction(described)
            }
        except Exception as e:
            print(f"Failed to inspect method {name} of class {cls.__name__}: {e}")
            
    return schema
