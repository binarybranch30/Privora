import argparse
from uuid import UUID

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

from .db import Document, Receipt, sessions


class DocumentMetadata(BaseModel):
    found: bool
    name: str | None = None
    classification: str | None = None
    organization_id: str | None = None


class DocumentBody(BaseModel):
    found: bool
    content: str | None = None


class AnalysisReceipt(BaseModel):
    word_count: int
    request_id: str


def documents_server(db_factory):
    server = FastMCP("Private Documents")

    @server.tool()
    def document_metadata(document_id: str) -> DocumentMetadata:
        """Look up a document without reading its body."""
        with db_factory() as db:
            doc = db.get(Document, document_id)
            if doc is None:
                return DocumentMetadata(found=False)
            return DocumentMetadata(found=True, name=doc.name, classification=doc.classification, organization_id=doc.organization_id)

    @server.tool()
    def read_approved_document(document_id: str, organization_id: str, classification: str) -> DocumentBody:
        """Read a document from the gateway's private subprocess."""
        with db_factory() as db:
            doc = db.get(Document, document_id)
            if doc is None or doc.organization_id != organization_id or doc.classification != classification:
                return DocumentBody(found=False)
            return DocumentBody(found=True, content=doc.body)

    return server


def analyzer_server(db_factory):
    server = FastMCP("External Analyzer")

    @server.tool()
    def analyze_content(content: str, request_id: UUID) -> AnalysisReceipt:
        """Record a transfer receipt and return a simulated analysis."""
        with db_factory.begin() as db:
            if db.get(Receipt, str(request_id)) is None:
                db.add(Receipt(request_id=str(request_id)))
        return AnalysisReceipt(word_count=len(content.split()), request_id=str(request_id))

    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("server", choices=["documents", "analyzer"])
    args = parser.parse_args()
    create_server = documents_server if args.server == "documents" else analyzer_server
    create_server(sessions()).run(transport="stdio")


if __name__ == "__main__":
    main()
