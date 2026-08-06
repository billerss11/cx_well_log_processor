import json
from pathlib import Path
from typing import Annotated

import typer

from welllog_engine.application.services.documents import DocumentError, document_service
from welllog_engine.application.services.qc import quality_control_service
from welllog_engine.application.services.scalar_data import scalar_data_service
from welllog_engine.application.services.system import get_health

app = typer.Typer(
    help="Offline well-log processing engine.",
    no_args_is_help=True,
    pretty_exceptions_enable=False,
)
package_app = typer.Typer(help="Inspect CX Log package files.")
qc_app = typer.Typer(help="Run quality-control checks.")
app.add_typer(package_app, name="package")
app.add_typer(qc_app, name="qc")


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
    index_candidate: Annotated[
        str | None,
        typer.Option(help="LAS index candidate ID when the file is ambiguous."),
    ] = None,
) -> None:
    """Inspect a well-log source or CX Log package."""
    try:
        summary = document_service.open_document(
            source,
            index_candidate_id=index_candidate,
        )
        document_service.close_document(summary.id)
    except (DocumentError, ValueError, OSError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=1) from error
    typer.echo(summary.model_dump_json(indent=2))


@app.command()
def convert(
    source: Annotated[Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)],
    destination: Annotated[Path, typer.Argument(dir_okay=False, resolve_path=True)],
    index_candidate: Annotated[
        str | None,
        typer.Option(help="LAS index candidate ID when the file is ambiguous."),
    ] = None,
) -> None:
    """Convert a well-log source into a CX Log package."""
    try:
        summary = document_service.open_document(
            source,
            index_candidate_id=index_candidate,
        )
        try:
            document_service.save_document(summary.id, destination)
            summary = document_service.get_document(summary.id)
        finally:
            document_service.close_document(summary.id)
    except (DocumentError, ValueError, OSError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=1) from error
    typer.echo(summary.model_dump_json(indent=2))


@app.command("export-csv")
def export_csv(
    source: Annotated[Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)],
    destination: Annotated[Path, typer.Argument(dir_okay=False, resolve_path=True)],
    dataset_id: Annotated[
        str | None,
        typer.Option(help="Dataset ID. Defaults to the first scalar dataset."),
    ] = None,
    curve: Annotated[
        list[str] | None,
        typer.Option(help="Curve ID to export. Repeat for multiple curves; omit for all."),
    ] = None,
) -> None:
    """Export a complete scalar dataset to CSV."""
    summary = document_service.open_document(source)
    try:
        selected_dataset = dataset_id or next(
            (
                dataset.id
                for dataset in summary.datasets
                if dataset.scalar_curve_count > 0
            ),
            None,
        )
        if selected_dataset is None:
            raise DocumentError("The document does not contain a scalar dataset.")
        exported = scalar_data_service.export_csv(
            summary.id,
            selected_dataset,
            destination,
            curve_ids=curve,
            cancel_requested=lambda: False,
        )
    except (DocumentError, ValueError, OSError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=1) from error
    finally:
        document_service.close_document(summary.id)
    typer.echo(str(exported))


@qc_app.command("run")
def run_qc(
    source: Annotated[Path, typer.Argument(exists=True, dir_okay=False, resolve_path=True)],
    dataset_id: Annotated[
        str | None,
        typer.Option(help="Dataset ID. Defaults to the first scalar dataset."),
    ] = None,
    index_candidate: Annotated[
        str | None,
        typer.Option(help="LAS index candidate ID when the file is ambiguous."),
    ] = None,
) -> None:
    """Run basic quality-control checks for one scalar dataset."""
    summary = document_service.open_document(
        source,
        index_candidate_id=index_candidate,
    )
    try:
        selected_dataset = dataset_id or next(
            (
                dataset.id
                for dataset in summary.datasets
                if dataset.scalar_curve_count > 0
            ),
            None,
        )
        if selected_dataset is None:
            raise DocumentError("The document does not contain a scalar dataset.")
        report = quality_control_service.run_dataset(summary.id, selected_dataset)
    except (DocumentError, ValueError, OSError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=1) from error
    finally:
        document_service.close_document(summary.id)
    typer.echo(report.model_dump_json(indent=2))


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
