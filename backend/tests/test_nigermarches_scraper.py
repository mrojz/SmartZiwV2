import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bs4 import BeautifulSoup

from utils.nigermarches_scraper import _extract_document_links


def test_extract_document_links_finds_pdf_and_download_button_skips_images():
    html = """
    <html><body>
      <a href="/wp-content/uploads/2026/08/avis.pdf">Avis (PDF)</a>
      <a href="/telecharger/avis-dappel-doffre/">Télécharger</a>
      <a href="/wp-content/uploads/2026/08/logo.png">logo</a>
      <a href="mailto:info@example.com">mail</a>
      <a href="#top">top</a>
      <a href="https://other.site/doc.docx">docx</a>
    </body></html>
    """
    links = _extract_document_links(BeautifulSoup(html, "html.parser"))
    assert links == [
        "https://www.nigermarches.com/wp-content/uploads/2026/08/avis.pdf",
        "https://www.nigermarches.com/telecharger/avis-dappel-doffre/",
        "https://other.site/doc.docx",
    ]
