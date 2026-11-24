"""CI helper: count calls to slow 68000 library routines (__mulsi3, __divsi3, ...) per object file.

    python tools/libcalls.py build/Crossmix
"""
import glob, os, sys

def main():
    d = sys.argv[1]
    try:
        from elftools.elf.elffile import ELFFile
        from elftools.elf.relocation import RelocationSection
    except ImportError:
        print('XMASM pyelftools missing'); return
    for path in sorted(glob.glob(os.path.join(d, '*.o'))):
        with open(path, 'rb') as f:
            magic = f.read(4); f.seek(0)
            if magic != b'\x7fELF':
                print('XMASM %s not ELF (%r)' % (os.path.basename(path), magic)); continue
            elf = ELFFile(f)
            counts, text = {}, 0
            for sec in elf.iter_sections():
                if sec.name == '.text': text = sec['sh_size']
                if isinstance(sec, RelocationSection):
                    syms = elf.get_section(sec['sh_link'])
                    for r in sec.iter_relocations():
                        name = syms.get_symbol(r['r_info_sym']).name
                        if name.startswith('__') or name in ('memcpy', 'memset'):
                            counts[name] = counts.get(name, 0) + 1
            print('XMASM %s text=%d %s' % (os.path.basename(path), text, ' '.join('%s=%d' % kv for kv in sorted(counts.items(), key=lambda kv: -kv[1]))))

if __name__ == '__main__':
    main()
