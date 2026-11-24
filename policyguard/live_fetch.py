import asyncio
import ipaddress
import socket
import ssl
from pathlib import Path
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

from .monitor import LIMIT, USER_AGENT, normalize


class FetchError(ValueError):
    pass


def fixture_url(value):
    url = httpx.URL(value)
    if (url.scheme != "https" or url.host != "127.0.0.1" or url.port is None
            or url.path != "/privacy" or url.query or url.fragment or url.userinfo):
        raise FetchError("INVALID_FIXTURE_URL")
    return url


def permitted_url(value, allowed):
    try:
        url = httpx.URL(value)
    except httpx.InvalidURL:
        raise FetchError("URL_NOT_ALLOWLISTED") from None
    if (url.scheme != "https" or url.port not in {None, 443} or url.userinfo
            or url.fragment or url.host not in allowed):
        raise FetchError("URL_NOT_ALLOWLISTED")
    return url


async def public_ip(host):
    addresses = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    ips = sorted({ipaddress.ip_address(item[4][0]) for item in addresses}, key=str)
    if not ips or any(not ip.is_global or ip.is_multicast or ip.is_reserved for ip in ips):
        raise FetchError("NONPUBLIC_ADDRESS")
    return str(ips[0])


async def fetch_live_policy(value, allowed, *, transport=None, resolve=public_ip, fixture_ca=""):
    url = fixture_url(value) if fixture_ca else permitted_url(value, allowed)
    trust = ssl.create_default_context(cafile=str(Path(fixture_ca))) if fixture_ca else True
    async with asyncio.timeout(20), httpx.AsyncClient(
        transport=transport, trust_env=False, timeout=8, verify=trust,
        headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"},
    ) as client:
        async def read(target):
            ip = "127.0.0.1" if fixture_ca else await resolve(target.host)
            async with client.stream(
                "GET", target.copy_with(host=ip), headers={"Host": target.netloc.decode(), "Connection": "close"},
                extensions={"sni_hostname": target.host},
            ) as response:
                if response.is_redirect:
                    return response.status_code, response.headers.get("location"), None
                if response.status_code in {404, 410}:
                    return response.status_code, None, None
                response.raise_for_status()
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise FetchError("UNSUPPORTED_CONTENT_ENCODING")
                data = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    data.extend(chunk)
                    if len(data) > LIMIT:
                        raise FetchError("RESPONSE_TOO_LARGE")
                return response.status_code, response.headers.get("content-type", ""), data.decode(response.encoding or "utf-8", errors="strict")

        for _ in range(4):
            status, _, robots_text = await read(url.copy_with(path="/robots.txt", query=None))
            if status not in {404, 410}:
                if status != 200 or robots_text is None:
                    raise FetchError("ROBOTS_UNAVAILABLE")
                robots = RobotFileParser()
                robots.parse(robots_text.splitlines())
                if not robots.can_fetch(USER_AGENT, str(url)):
                    raise FetchError("ROBOTS_DENIED")
            status, detail, body = await read(url)
            if 300 <= status < 400 and detail:
                if fixture_ca:
                    raise FetchError("FIXTURE_REDIRECT_DENIED")
                url = permitted_url(str(url.join(detail)), allowed)
                continue
            if status != 200 or body is None:
                raise FetchError("POLICY_UNAVAILABLE")
            media = detail.split(";", 1)[0].strip().lower()
            if media == "text/html":
                soup = BeautifulSoup(body, "html.parser")
                for element in soup.select("script,style,nav,footer,header,noscript,aside"):
                    element.decompose()
                root = soup.find("main") or soup.find("article") or soup.body or soup
                parts = root.find_all(["p", "li", "h1", "h2", "h3", "tr"])
                body = "\n".join(part.get_text(" ", strip=True) for part in parts) if parts else root.get_text(" ", strip=True)
            elif media not in {"text/plain", "text/markdown"}:
                raise FetchError("UNSUPPORTED_POLICY_TYPE")
            text = normalize(body)
            if len(text) < 30 or "\x00" in text:
                raise FetchError("MALFORMED_POLICY")
            return str(url), text
        raise FetchError("TOO_MANY_REDIRECTS")
