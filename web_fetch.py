import httpx
from bs4 import BeautifulSoup


async def fetch_page_text(url: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)[:5000]
    except Exception as exc:
        return f"Could not fetch page: {exc}"