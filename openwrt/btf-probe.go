// SPDX-License-Identifier: MIT
// Build from wing/ to reuse the runtime's existing cilium/ebpf dependency.
package main

import (
	"debug/elf"
	"flag"
	"fmt"
	"os"
	"runtime"

	"github.com/cilium/ebpf/btf"
)

func validateBTF(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 24 || info.Size() > 128*1024*1024 {
		return fmt.Errorf("BTF must be a regular file between 24 bytes and 128 MiB")
	}
	var header [4]byte
	if _, err = file.ReadAt(header[:], 0); err != nil {
		return err
	}
	if string(header[:]) == "\x7fELF" {
		image, err := elf.NewFile(file)
		if err != nil {
			return err
		}
		machine := map[string]elf.Machine{"amd64": elf.EM_X86_64, "arm64": elf.EM_AARCH64}[runtime.GOARCH]
		if image.Class != elf.ELFCLASS64 || image.Data != elf.ELFDATA2LSB || image.Machine != machine {
			return fmt.Errorf("vmlinux ELF architecture does not match this router")
		}
	} else if header[0] != 0x9f || header[1] != 0xeb || header[2] != 1 {
		return fmt.Errorf("invalid little-endian BTF header")
	}
	spec, err := btf.LoadSpec(path)
	if err != nil {
		return fmt.Errorf("parse BTF: %w", err)
	}
	for _, name := range []string{"sk_buff", "sock", "net_device"} {
		if _, err := spec.AnyTypeByName(name); err != nil {
			return fmt.Errorf("required kernel type %s: %w", name, err)
		}
	}
	return nil
}

func main() {
	path := flag.String("file", "", "BTF/vmlinux file selected from the runtime's kernel search paths")
	flag.Parse()
	if *path == "" || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "usage: btf-probe --file /path/to/vmlinux")
		os.Exit(2)
	}
	if err := validateBTF(*path); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("BTF parsed; required network types found. This does not load eBPF.")
}
