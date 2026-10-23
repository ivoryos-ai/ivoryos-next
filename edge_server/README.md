# ivoryos-edge

The IvoryOS edge: it runs next to your instruments, reads the Python classes that drive them, and
serves a web page to design, run and optimize experiments with them. Every method becomes a step
you can drag into a workflow, and every argument a field of the right type. Runs, results and
workflows are kept on that computer.

Most people use it through the [IvoryOS desktop app](https://github.com/ivoryzh/ivoryos-next/releases),
which installs this package itself. Install it on its own to run a deck from your own Python
environment, such as one your editor uses.

## Install

```bash
pip install ivoryos-edge
```

Python 3.10 or newer. The web interface is inside the package; nothing else is needed.

## Run your instruments

End a script that creates your instrument objects with `ivoryos_edge.run(__name__)`:

```python
import ivoryos_edge
from my_lab import SyringePump

pump = SyringePump(port="COM3")  # each object becomes an instrument

ivoryos_edge.run(__name__)       # http://localhost:8080
```

Then open `http://localhost:8080` in a browser on that computer. A deck can also be a JSON file,
run with `ivoryos-edge --deck deck.json`.

## Links

- [Documentation](https://ivoryzh.github.io/ivoryos-next/)
- [Automation Hub](https://ivoryos.ai): drivers, platforms and workflow templates
- [Source and issues](https://github.com/ivoryzh/ivoryos-next)
