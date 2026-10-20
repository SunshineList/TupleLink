// SPDX-License-Identifier: MIT
// Test-only PID 1 for an isolated QEMU kernel; never run on the host.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"time"

	"golang.org/x/sys/unix"
)

func main() {
	if os.Getpid() != 1 {
		fmt.Fprintln(os.Stderr, "kernel probe init must only run as PID 1 inside the test VM")
		os.Exit(2)
	}
	for path, kind := range map[string]string{"/proc": "proc", "/sys": "sysfs"} {
		os.MkdirAll(path, 0755)
		if err := unix.Mount(kind, path, kind, 0, ""); err != nil {
			panic(err)
		}
	}
	// This sysctl change is confined to the disposable VM. The product probe
	// never changes JIT configuration or attaches programs to a network device.
	os.WriteFile("/proc/sys/net/core/bpf_jit_enable", []byte("1"), 0644)
	command := exec.Command("/probe", "--kernel")
	command.Stdout, command.Stderr, command.Stdin = os.Stdout, os.Stderr, os.Stdin
	code := 0
	if err := command.Run(); err != nil {
		if status, ok := err.(*exec.ExitError); ok {
			code = status.ExitCode()
		} else {
			fmt.Println(err)
			code = 2
		}
	}
	fmt.Printf("NaiLinkKernelProbeResult=%d\n", code)
	for {
		time.Sleep(time.Hour)
	}
}
