import argparse
from uuid import UUID

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel
from sqlalchemy import insert, select

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


def analyzer_server(db_factory, receiver=None):
    server = FastMCP("External Analyzer")

    @server.tool()
    def analyze_content(content: str, request_id: UUID, record_byte_count: bool = False) -> AnalysisReceipt:
        """Record a transfer receipt and return a simulated analysis."""
        with db_factory.begin() as db:
            existing = db.scalar(select(Receipt.request_id).where(Receipt.request_id == str(request_id)))
            if existing is None:
                values = {"request_id": str(request_id),
                          "byte_count": len(content.encode("utf-8")) if record_byte_count else None}
                if receiver:
                    values["receiver"] = receiver
                db.execute(insert(Receipt.__table__).values(**values))
        return AnalysisReceipt(word_count=len(content.split()), request_id=str(request_id))

    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("server", choices=["documents", "analyzer"])
    parser.add_argument("--receiver", choices=["fictional_analyzer", "fictional_analyzer_b", "local_analyzer"])
    args = parser.parse_args()
    create_server = documents_server if args.server == "documents" else analyzer_server
    server = create_server(sessions(), args.receiver) if args.server == "analyzer" else create_server(sessions())
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
