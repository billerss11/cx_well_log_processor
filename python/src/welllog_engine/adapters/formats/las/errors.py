class LasImportError(ValueError):
    pass


class LasFileTooLargeError(LasImportError):
    pass


class LasIndexSelectionRequired(LasImportError):
    code = "INDEX_SELECTION_REQUIRED"

    def __init__(self, candidates: list[dict[str, object]]) -> None:
        super().__init__(
            "This LAS file has multiple credible index curves. Select the index to use."
        )
        self.details: dict[str, object] = {"candidates": candidates}
