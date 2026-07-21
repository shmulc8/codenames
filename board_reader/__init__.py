"""Read a photographed Codenames board into a CSV grid."""

from .board_to_csv import BoardReadError, read_board, write_csv

__all__ = ["BoardReadError", "read_board", "write_csv"]
