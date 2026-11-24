import re
from pathlib import PurePosixPath

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

MAX_BYTES = 64_000


def validate_resource(path, commit):
    parts = path.split("/")
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or any(
        not item or item in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9_.-]+", item) for item in parts
    ) or PurePosixPath(path).suffix.lower() not in {".md", ".txt"}:
        raise ValueError("Use a bounded text path and full commit SHA")


async def github_text(settings, repository, path, commit):
    if not settings.github_command or not settings.github_token or repository != settings.github_repo:
        raise ValueError("GitHub connector is unavailable for this repository")
    validate_resource(path, commit)
    owner, repo = repository.split("/")
    params = StdioServerParameters(
        command=settings.github_command, args=["--read-only", "--tools", "get_file_contents", "stdio"],
        env={"GITHUB_PERSONAL_ACCESS_TOKEN": settings.github_token},
    )
    async with stdio_client(params) as (incoming, outgoing), ClientSession(incoming, outgoing) as client:
        await client.initialize()
        result = await client.call_tool("get_file_contents", {"owner": owner, "repo": repo, "path": path, "sha": commit})
    if result.isError:
        raise ValueError("GitHub file read failed")
    # The pinned server adds metadata or a note for a symlink, fallback, or non-text result.
    messages = [item.text for item in result.content if item.type == "text"]
    if len(messages) != 1 or not re.fullmatch(r"successfully downloaded text file \(SHA: [a-f0-9]{40}\)", messages[0]):
        raise ValueError("GitHub did not return a regular text file")
    resources = [item.resource for item in result.content if item.type == "resource"]
    expected = f"repo://{owner}/{repo}/sha/{commit}/contents/{path}"
    if len(resources) != 1 or not hasattr(resources[0], "text") or str(resources[0].uri) != expected:
        raise ValueError("GitHub did not return the exact registered text resource")
    text = resources[0].text
    if not text.strip() or len(text.encode()) > MAX_BYTES or "\x00" in text:
        raise ValueError("GitHub file exceeded the supported text bounds")
    return text
