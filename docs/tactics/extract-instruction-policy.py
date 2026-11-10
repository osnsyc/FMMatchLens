"""Export finite role/position instruction policy tables without calling game code.

Requires pefile and unicorn. The input is never loaded as a Windows DLL: Unicorn
executes isolated static integer predicates with synthetic position/date inputs.
No game memory, hooks, or native entry points are added to the product.
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn.x86_const import (
    UC_X86_REG_RCX, UC_X86_REG_RDX, UC_X86_REG_R8, UC_X86_REG_R9,
    UC_X86_REG_RSP, UC_X86_REG_RAX,
)

SOURCE_SHA256 = "252ff8fb5b7a4a5a5464db6ba632e309eef9b6e65ffa992ae20575a189e66c6a"
BASE = 0x180000000
POLICIES = {"inPossession": 0x46C0FE0, "outOfPossession": 0x08D540}
UI_DATE = 0x1B000000  # Both native UI group selectors pass this constant.
DUTIES = [0, 0x200000, 0x400000, 0x800000, 0x2000000, 0x4000000, 0x400000000]
POSITIONS = sorted({1 << bit for bit in range(17) if bit != 1} | {
    base | side for base in [0x10, 0x80, 0x400, 0x2000, 0x4000]
    for side in [0x100000, 0x200000]
})


class PolicyMachine:
    def __init__(self, binary):
        pe = pefile.PE(str(binary), fast_load=True)
        if pe.OPTIONAL_HEADER.ImageBase != BASE:
            raise ValueError("Unexpected image base")
        self.uc = Uc(UC_ARCH_X86, UC_MODE_64)
        self.uc.mem_map(BASE, 0x6000000)
        for start, size in [(0xB0000, 0x20000), (0x8D000, 0x1000), (0x46C0000, 0x3000)]:
            self.uc.mem_write(BASE + start, pe.get_data(start, size))
        # Switch dispatch tables live outside the predicate's code range.
        for section in pe.sections:
            if section.Name.rstrip(b"\0") in (b".data1", b".shared", b".rodata"):
                self.uc.mem_write(BASE + section.VirtualAddress, section.get_data())
        self.group_order = []
        for group in range(17):
            pointer, count = struct.unpack("<QQ", pe.get_data(0x4EE1C50 + group * 24, 16))
            if count > 16:
                raise ValueError("Unexpected native instruction group")
            self.group_order.append(list(struct.unpack("<" + "I" * count, pe.get_data(pointer - BASE, count * 4))))
        pe.close()
        self.uc.mem_map(0x100000, 0x10000)
        self.stack, self.position, self.date, self.result, self.stop = (
            0x108008, 0x101000, 0x101010, 0x101020, 0x102000)
        self.uc.mem_write(self.stack, self.stop.to_bytes(8, "little"))
        self.uc.mem_write(self.stack + 0x28, self.result.to_bytes(8, "little"))
        self.uc.mem_write(self.date, UI_DATE.to_bytes(4, "little"))

    def states(self, phase, position, role):
        self.uc.mem_write(self.position, position.to_bytes(4, "little"))
        values = []
        for instruction in range(1, 43):
            for register, value in [(UC_X86_REG_RCX, instruction),
                                    (UC_X86_REG_RDX, self.position), (UC_X86_REG_R8, role),
                                    (UC_X86_REG_R9, self.date), (UC_X86_REG_RSP, self.stack)]:
                self.uc.reg_write(register, value)
            self.uc.mem_write(self.result, b"\xff\xff\xff\xff")
            self.uc.emu_start(BASE + POLICIES[phase], self.stop, count=10000)
            state = int.from_bytes(self.uc.mem_read(self.result, 4), "little")
            if state not in range(4) or self.uc.reg_read(UC_X86_REG_RAX) & 0xFF != (state == 0):
                raise ValueError(f"Invalid predicate result: {phase}/{position:x}/{role:x}/{instruction}")
            values.append(state)
        return "".join(str(v) for v in values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--decoder", type=Path, default=Path("src/FMMatchLens.Plugin/Memory/TacticalFormationDecoder.cs"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.binary.read_bytes()).hexdigest() != SOURCE_SHA256:
        parser.error("Only the verified steam-26340721 binary is supported")
    machine = PolicyMachine(args.binary)
    decoder = args.decoder.read_text(encoding="utf-8")
    tables, vectors, indices = {}, [], {}
    for phase, section in [("inPossession", "InPossessionRoles"), ("outOfPossession", "OutOfPossessionRoles")]:
        text = decoder.split(section + " =", 1)[1].split("};", 1)[0]
        roles = sorted({int(value, 16) for value in re.findall(r"\[0x([0-9a-fA-F]+)\]", text)})
        table = {}
        for role in sorted({role | duty for role in roles for duty in DUTIES}):
            row = []
            for position in POSITIONS:
                vector = machine.states(phase, position, role)
                if vector not in indices:
                    indices[vector] = len(vectors)
                    vectors.append(vector)
                row.append(indices[vector])
            table[f"{role:X}"] = row
        tables[phase] = table
        print(f"{phase}: {len(table)} role/duty combinations, {len(POSITIONS)} position masks", flush=True)
    result = {"schema": 1, "build": "steam-26340721", "sourceSha256": SOURCE_SHA256,
              "uiDate": UI_DATE, "groupOrder": machine.group_order,
              "positions": POSITIONS, "states": vectors, **tables}
    # One compact numeric row per role; retain separate lines for policy vectors.
    text = json.dumps(result, ensure_ascii=False, indent=2)
    text = re.sub(r"\[\n(?:\s+\d+,?\n)+\s*\]", lambda match: "[" + ",".join(re.findall(r"\d+", match[0])) + "]", text)
    args.output.write_text(text + "\n", encoding="utf-8", newline="\n")
    print(f"Exported {len(vectors)} distinct policy vectors ({args.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
