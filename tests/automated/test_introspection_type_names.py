import typing
import dataclasses
import enum

from ivoryos_edge.introspection import extract_type_info


def test_plain_builtin_types_get_clean_names_not_class_repr():
    # str(float) is Python's repr, "<class 'float'>" — cast_value/cast_arguments never read this
    # string (they always re-introspect the real annotation object), so it was pure noise that
    # every frontend consumer had to strip with its own regex.
    assert extract_type_info(float)["type"] == "float"
    assert extract_type_info(int)["type"] == "int"
    assert extract_type_info(str)["type"] == "str"
    assert extract_type_info(bool)["type"] == "bool"


def test_typing_generics_are_unaffected():
    assert extract_type_info(typing.List[str])["type"] == "List[str]"
    assert extract_type_info(typing.Optional[float])["type"] == "Optional[float]"


def test_a_union_reads_the_same_on_every_python_version():
    # Python 3.14 made Optional[float] and `float | None` one object, printed "float | None";
    # before, each printed as written. A schema says it one way, typing's, however it was written.
    assert extract_type_info(float | None)["type"] == "Optional[float]"
    assert extract_type_info(typing.Union[int, str])["type"] == "Union[int, str]"
    assert extract_type_info(int | str)["type"] == "Union[int, str]"
    assert extract_type_info(typing.Union[int, str, None])["type"] == "Union[int, str, NoneType]"
    assert extract_type_info(typing.List[typing.Optional[float]])["type"] == "List[Optional[float]]"
    assert extract_type_info(typing.Dict[str, typing.Optional[int]])["type"] == "Dict[str, Optional[int]]"
    assert extract_type_info(typing.Optional[typing.List[int]])["type"] == "Optional[List[int]]"
    assert extract_type_info(list[float | None])["type"] == "list[Optional[float]]"
    assert extract_type_info(typing.Callable[[int], typing.Optional[str]])["type"] == "Callable[[int], Optional[str]]"
    # Python 3.10 calls list[int] a class; it is not one, so it keeps its argument.
    assert extract_type_info(list[int])["type"] == "list[int]"
    # What an older Python takes from typing_extensions reads as a newer one's typing.
    import typing_extensions
    from ivoryos_edge.introspection import type_name
    assert type_name(typing_extensions.Literal["a", "b"]) == "Literal['a', 'b']"


def test_a_union_return_reads_the_same_on_every_python_version():
    from ivoryos_edge.introspection import inspect_device_module

    class Probe:
        def read(self) -> float | None:
            return None

        def mode(self) -> typing.Union[int, str]:
            return 1

    methods = inspect_device_module(Probe())
    assert methods["read"]["return_type"] == "Optional[float]"
    assert methods["mode"]["return_type"] == "Union[int, str]"


def test_enum_and_dataclass_names_still_clean():
    class Color(enum.Enum):
        RED = "red"
        BLUE = "blue"

    info = extract_type_info(Color)
    assert info["type"] == "Color"
    assert info["options"] == ["red", "blue"]

    @dataclasses.dataclass
    class Config:
        mode: str = "auto"

    info = extract_type_info(Config)
    assert info["type"] == "Config"
    assert info["is_object"] is True
    assert info["fields"]["mode"]["type"] == "str"
