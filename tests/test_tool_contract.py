"""The eight MCP tools keep exact input schemas, descriptions and output shapes.

tests/tool-contract.json was recorded before schema v4, investment transactions
and liabilities were added; none of those may change what MCP clients see.
"""
import asyncio
import json
from pathlib import Path
from queries import Queries
from server import create_server, TOOLS

CONTRACT = Path(__file__).with_name('tool-contract.json')
ARGS = {'cash_flow':{'start':'2026-11-01','end':'2026-12-01'}}


def listing(path):
    tools = asyncio.run(create_server(path).list_tools())
    return {t.name:{'description':t.description,'inputSchema':t.inputSchema,'outputSchema':t.outputSchema,
        'annotations':t.annotations.model_dump() if t.annotations else None} for t in tools}


def shape(value):
    """Keys only (no values); opaque source ids in as_of collapse to one key."""
    if isinstance(value,dict):
        return {('<source id>' if k.startswith('src_') else k):shape(v) for k,v in sorted(value.items())}
    if isinstance(value,list):
        merged = {}
        for item in value:
            s = shape(item)
            if not isinstance(s,dict): return [s]
            merged.update(s)
        return [merged] if merged else []
    return None


def outputs(path):
    q = Queries(path)
    return {name:shape(getattr(q,name)(**ARGS.get(name,{}))) for name in TOOLS}


def test_tool_schemas_and_output_shapes_are_unchanged(snapshot):
    _,path = snapshot
    expected = json.loads(CONTRACT.read_text())
    assert listing(path) == expected['tools']
    assert outputs(path) == expected['outputs']
