import json
from pathlib import Path
from typing import Annotated

import typer

from welllog_engine.application.services.documents import DocumentError, document_service
from welllog_engine.application.services.system import get_health

app = typer.Typer(
    help="Offline well-log processing engine.",
    no_args_is_help=True,
    pretty_exceptions_enable=False,
)
package_app = typer.Typer(help="Inspect CX Log package files.")
app.add_typer(package_app, name="package")


@app.callback()
def main() -> None:
    """Run well-log engine commands."""


@app.command()
def doctor(
    output: Annotated[
        str,
        typer.Option(help="Output format: text or json."),
    ] = "text",
) -> None:
    """Check that the engine can start."""
    health = get_health()

    if output == "json":
        typer.echo(json.dumps(health.model_dump(), separators=(",", ":")))
        return

    if output != "text":
        raise typer.BadParameter("output must be 'text' or 'json'")

    typer.echo(
        f"Engine {health.engine_version} is {health.status} "
        f"(API {health.api_version})"
    )


@app.command()
def inspect(
    source: Annotated[Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)],
) -> None:
    """Inspect a well-log source or CX Log package."""
    try:
        summary = document_service.inspect(source)
    except (DocumentError, ValueError, OSError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=1) from error
    typer.echo(summary.model_dump_json(indent=2))


@app.command()
def convert(
    source: Annotated[Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)],
    destination: Annotated[Path, typer.Argument(dir_okay=False, resolve_path=True)],
) -> None:
    """Convert a well-log source into a CX Log package."""
    try:
        summary = document_service.convert(source, destination)
    except (DocumentError, ValueError, OSError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=1) from error
    typer.echo(summary.model_dump_json(indent=2))


@package_app.command("verify")
def package_verify(
    package_path: Annotated[
        Path,
        typer.Argument(exists=True, dir_okay=False, resolve_path=True),
    ],
) -> None:
    """Verify CX Log package structure and checksums."""
    result = document_service.verify(package_path)
    typer.echo(result.model_dump_json(indent=2))
    if not result.valid:
        raise typer.Exit(code=1)


def run() -> None:
    app()
