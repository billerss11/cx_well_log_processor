import json
from typing import Annotated

import typer

from welllog_engine.application.services.system import get_health

app = typer.Typer(
    help="Offline well-log processing engine.",
    no_args_is_help=True,
    pretty_exceptions_enable=False,
)


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


def run() -> None:
    app()
