"""Plan explicit deployment targets; do not turn library builds into images."""
import json
import os

def plan():
    affected = json.loads(os.environ["TASKS"]).get("build", [])
    target = os.environ.get("TARGET", "affected")
    services = [("backend", "backend", "backend/Dockerfile"),
                ("checkout", "checkout", "checkout/Dockerfile")]
    return [dict(service=s, dockerfile=d)
            for s, p, d in services
            if target in ("all", s) or target == "affected" and p in affected]

if __name__ == "__main__":
    matrix = plan()
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"matrix={json.dumps(matrix, separators=(',', ':'))}\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write(f"Commit: `{os.environ['GITHUB_SHA']}`\n\n")
        summary.write("Planned builds:\n\n")
        for item in matrix:
            summary.write(f"- {item['service']}\n")
        if not matrix:
            summary.write("No affected deployment targets.\n")
