"""One driver, several instruments (parts.py): `__ivoryos_instruments__`."""

from ivoryos_edge.introspection import inspect_device_module
from ivoryos_edge.parts import expand


class Mount:
    def __init__(self, side):
        self.side = side

    def aspirate(self, volume: float) -> str:
        return f"{self.side} drew {volume}"


class Gripper:
    def grip(self) -> None:
        pass


class Robot:
    """A robot whose mounted things are instruments of their own."""

    def __init__(self, parts):
        self._parts = parts

    def home(self) -> None:
        pass

    def __ivoryos_instruments__(self):
        return self._parts


def test_each_part_is_an_instrument_named_after_the_driver_right_after_it():
    left, gripper = Mount("left"), Gripper()
    robot = Robot({"left": left, "gripper": gripper})
    errors = []
    deck = expand({"flex": robot, "balance": object()}, errors)
    assert list(deck) == ["flex", "flex_left", "flex_gripper", "balance"]
    assert deck["flex_left"] is left and deck["flex_gripper"] is gripper
    assert errors == []
    assert "aspirate" in inspect_device_module(deck["flex_left"])
    assert "__ivoryos_instruments__" not in inspect_device_module(robot), "a dunder is never a step"


def test_a_part_that_cannot_be_named_is_reported_and_the_rest_stay():
    errors = []
    deck = expand({"flex": Robot({"left": Mount("left"), "not ok": Mount("x"), "": Mount("y")}),
                   "flex_right": object()}, errors)
    assert list(deck) == ["flex", "flex_left", "flex_right"]
    assert [e["stage"] for e in errors] == ["parts", "parts"]
    assert "cannot be part of an instrument name" in errors[0]["error"]


def test_a_part_whose_name_is_taken_is_left_out_not_swapped_in():
    taken = object()
    errors = []
    deck = expand({"flex": Robot({"right": Mount("right")}), "flex_right": taken}, errors)
    assert deck["flex_right"] is taken
    assert "already an instrument" in errors[0]["error"]


def test_a_driver_that_fails_to_say_keeps_its_place_and_says_why():
    class Broken:
        def __ivoryos_instruments__(self):
            raise RuntimeError("no worktable file")

    errors = []
    broken = Broken()
    assert expand({"flex": broken}, errors) == {"flex": broken}
    assert errors[0]["name"] == "flex" and "no worktable file" in errors[0]["error"]


def test_parts_of_parts_are_named_down_the_chain_and_a_cycle_stops():
    inner = Robot({"tip": Mount("tip")})
    errors = []
    deck = expand({"arm": Robot({"wrist": inner})}, errors)
    assert list(deck) == ["arm", "arm_wrist", "arm_wrist_tip"]

    cyclic = Robot({})
    cyclic._parts = {"again": cyclic}
    deck = expand({"loop": cyclic}, [])
    assert list(deck) == ["loop", "loop_again", "loop_again_again", "loop_again_again_again"]
