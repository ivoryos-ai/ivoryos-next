---
title: Device layer or abstraction layer?
description: Expose the vendor SDK as it is, or write a class that speaks the lab's language? How to decide, and how to do both.
sidebar:
  order: 3
---

IvoryOS reads whatever class you give it. The question is *which* class: the vendor's SDK object
with its forty methods, or a short class of your own that says what the instrument does on your
bench. Both work. They make very different apps.

## What the scientist sees is the method list

Every public method is a step in the Designer's toolbox and a form on the Instruments page. A
raw SDK gives:

```
pump.write_register(addr, value)   pump.read_register(addr)   pump.set_mode(0x02)
pump.start()   pump.stop()   pump.get_status()   pump.flush_buffer()  ...
```

A class written for the bench gives:

```
pump.dispense(volume_ml, flow_rate_ml_min=2.0)   pump.prime(cycles=3)   pump.refill()
```

The second is what a workflow reads like, what the assistant can reason about, and what a
colleague can run without the manual. So the guidance is simple:

**Expose what a person would say at the bench.** One method is one action that completes:
*dispense 2 mL*, *hold 30 minutes*, *weigh*. Arguments are in the units the lab uses, and the
return value is the measurement, as a number or an object with numbers in it.

## When the device layer is fine

- The SDK already speaks that language (`pump.dispense(volume=…)`). Use it directly.
- You are characterising a new instrument and want every knob on the Instruments page for a
  while. Put the SDK object on the deck as its own instrument, and keep it there until the real
  methods are clear.
- The vendor class is a thin wrapper over a well-designed protocol, and the extra forty methods
  do not get in the way.

## When to write the abstraction

- The SDK exposes registers, modes, buffers or state machines.
- An action takes several SDK calls in a fixed order (set mode, start, wait, read, stop).
- The SDK's units are not the lab's (steps instead of mL, raw counts instead of mg).
- The vendor class inherits many methods you do not want shown (every method of a base class is a
  step, including a modelling library's).
- You want a limit that lives in code, such as a maximum temperature the hardware cannot be
  trusted to refuse. (Limits that may change per bench belong on the Safety page instead; see
  below.)

Write it by **composition**, not inheritance: keep the vendor object in a private attribute and
expose your own methods. Inheriting would publish the whole base class.

```python
class Reactor:
    """Heated stirrer block, one vial."""

    def __init__(self, port: str, max_temperature_c: float = 150.0):
        self._dev = VendorHotplate(port)      # the device layer, hidden
        self.max_temperature_c = max_temperature_c

    def set_temperature(self, setpoint_c: float) -> dict:
        """Set the block setpoint and wait until it is reached."""
        if setpoint_c > self.max_temperature_c:
            raise ValueError(f"{setpoint_c} C exceeds the block limit of {self.max_temperature_c} C")
        self._dev.write_setpoint(setpoint_c)
        self._dev.wait_stable(tolerance=0.5)
        return {"setpoint_c": setpoint_c, "reached_c": self._dev.read_temperature()}

    def hold(self, minutes: float) -> dict:
        """Hold at the current setpoint. Blocks for the whole hold."""
        time.sleep(minutes * 60)
        return {"minutes": minutes}

    @property
    def temperature(self) -> float:
        return self._dev.read_temperature()
```

## Both at once

You do not have to choose for the whole deck. Common shapes:

- **Abstraction on the deck, device layer reachable by hand.** Put the vendor object on the deck
  too, under a name like `reactor_raw`. Workflows use `reactor`; the Instruments page still has
  every SDK call for troubleshooting. Nothing stops a workflow from using the raw one, so this
  suits a lab that trusts its users; the Safety page can add rules around either.
- **Hide the dangerous half.** Keep the SDK methods on your class but prefix the ones nobody
  should call from a workflow with `_`. They stay available to your own code.
- **One method that runs a whole sequence.** A `run_calibration()` that does ten things inside is
  fine: it is one step the scientist can reason about. Declare what must hold before it and what it
  leaves behind on the Safety page (a rule and a state), since the guard cannot see inside it.

## Where limits go

Resist the urge to put every bound in the driver. A bound that comes from the hardware (the block
cannot exceed 150 °C) belongs in code, as above, because it is true on every bench. A bound that
comes from *this* experiment or *this* lab (today's vials tolerate 120 °C; this pump never
dispenses more than 5 mL into a 10 mL vial) belongs on the **Safety** page: it is checked before a
run starts and before each call, outside the driver, and survives a driver update. Nothing is asked
of the driver for that. See [Safeguards](/dev/extend/safeguards/).

The same goes for units and labels: the Safety page attaches a unit to a field without the driver
changing, and the Instruments, Run and Data History pages show it everywhere. A driver *may*
declare one (`Annotated[float, Unit("°C")]`) when it describes what the code really does.
