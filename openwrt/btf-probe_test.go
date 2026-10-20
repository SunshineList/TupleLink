package main

import (
	"debug/elf"
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/cilium/ebpf/btf"
)

func TestELFArchitectureProfiles(t *testing.T) {
	for _, item := range []struct {
		arch    string
		class   elf.Class
		data    elf.Data
		machine elf.Machine
	}{
		{"amd64", elf.ELFCLASS64, elf.ELFDATA2LSB, elf.EM_X86_64},
		{"arm64", elf.ELFCLASS64, elf.ELFDATA2LSB, elf.EM_AARCH64},
		{"arm", elf.ELFCLASS32, elf.ELFDATA2LSB, elf.EM_ARM},
		{"mips", elf.ELFCLASS32, elf.ELFDATA2MSB, elf.EM_MIPS},
		{"mipsle", elf.ELFCLASS32, elf.ELFDATA2LSB, elf.EM_MIPS},
	} {
		class, data, machine := elfArchitecture(item.arch)
		if class != item.class || data != item.data || machine != item.machine {
			t.Fatal("wrong ELF ABI", item.arch, class, data, machine)
		}
	}
	if class, _, _ := elfArchitecture("unsupported"); class != elf.ELFCLASSNONE {
		t.Fatal("unsupported ABI accepted")
	}
}

func rawBTF(t *testing.T, names ...string) []byte {
	t.Helper()
	var types []btf.Type
	for _, name := range names {
		types = append(types, &btf.Struct{Name: name, Size: 4, Members: []btf.Member{{Name: "fixture", Type: &btf.Int{Name: "u32", Size: 4, Encoding: btf.Unsigned}}}})
	}
	builder, err := btf.NewBuilder(types)
	if err != nil {
		t.Fatal(err)
	}
	data, err := builder.Marshal(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestValidateBTFValidRawAndSymlink(t *testing.T) {
	directory := t.TempDir()
	file := filepath.Join(directory, "vmlinux")
	if err := os.WriteFile(file, rawBTF(t, "sk_buff", "sock", "net_device"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directory, "vmlinux-6.12.94")
	if err := os.Symlink("vmlinux", link); err != nil {
		t.Fatal(err)
	}
	if err := validateBTF(link); err != nil {
		t.Fatal(err)
	}
}

func TestValidateBTFRejectsInvalidData(t *testing.T) {
	valid := rawBTF(t, "sk_buff", "sock", "net_device")
	wrongEndian := append([]byte(nil), valid...)
	wrongEndian[0], wrongEndian[1] = wrongEndian[1], wrongEndian[0]
	for name, data := range map[string][]byte{
		"empty": nil, "text": []byte("not BTF, despite a matching filename"),
		"truncated": valid[:24], "wrong-endian": wrongEndian,
		"missing-types": rawBTF(t, "other_type"),
	} {
		t.Run(name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "vmlinux")
			if err := os.WriteFile(file, data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := validateBTF(file); err == nil {
				t.Fatal("invalid BTF accepted")
			}
		})
	}
}

func TestValidateBTFRejectsForeignELF(t *testing.T) {
	data := make([]byte, 64)
	copy(data, []byte{'\x7f', 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(data[16:], 1)
	machine := uint16(183)
	if runtime.GOARCH == "arm64" {
		machine = 62
	}
	binary.LittleEndian.PutUint16(data[18:], machine)
	binary.LittleEndian.PutUint32(data[20:], 1)
	binary.LittleEndian.PutUint16(data[52:], 64)
	file := filepath.Join(t.TempDir(), "vmlinux")
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := validateBTF(file); err == nil {
		t.Fatal("foreign ELF accepted")
	}
}
