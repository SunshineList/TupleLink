#!/usr/bin/env python3
"""Real image/API/SQLite smoke; isolated volume, no privileged/host networking."""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, check=check)
    return result.stdout.strip()


def main(image):
    name = "nailink-smoke-" + uuid4().hex[:12]
    volume = name + "-data"
    token = None
    base = None

    def request(query):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(base + "/graphql", data=json.dumps({"query": query}).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.load(response)
        if result.get("errors"):
            raise RuntimeError(result["errors"])
        return result["data"]

    def start():
        nonlocal base
        docker("run", "-d", "--name", name, "-p", "127.0.0.1::2023", "--mount", "type=volume,source=" + volume + ",target=/etc/daed",
               image, "daed", "run", "--api-only", "--config", "/etc/daed", "--listen", "0.0.0.0:2023")
        port = docker("port", name, "2023/tcp").rsplit(":", 1)[1]
        base = "http://127.0.0.1:" + port
        for _ in range(100):
            try:
                with urllib.request.urlopen(base, timeout=.5) as response:
                    if b"<html" in response.read():
                        return
            except (OSError, urllib.error.URLError):
                pass
            if docker("inspect", "--format", "{{.State.Running}}", name) != "true":
                raise RuntimeError("Container exited before readiness")
            time.sleep(.2)
        raise RuntimeError("Container API readiness timed out")

    try:
        print(docker("run", "--rm", image, "daed", "--version"))
        docker("volume", "create", volume)
        start()
        docker("exec", name, "sh", "-c", "test -s /usr/share/daed/geoip.dat && test -s /usr/share/daed/geosite.dat && test ! -d /src && test ! -d /usr/local/go")
        token = request('mutation{createUser(username:"dockertest",password:"DockerSmoke1234")}')["createUser"]
        created = request('mutation{createGroup(name:"PersistedDockerTest",policy:fixed,policyParams:[]){id name}}')["createGroup"]
        docker("stop", "--time", "15", name)
        docker("rm", name)
        start()
        if created not in request("query{groups{id name}}")['groups']:
            raise RuntimeError("SQLite configuration lost after container recreation")
        print("PASS: image version, embedded page, geodata, authenticated API and SQLite persistence; API-only")
    except BaseException:
        print(docker("logs", "--tail", "50", name, check=False))
        raise
    finally:
        docker("rm", "-f", name, check=False)
        docker("volume", "rm", volume, check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    main(parser.parse_args().image)
