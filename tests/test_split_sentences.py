"""
Sentence Splitter Test
======================
Checks split_into_sentences() in scripts/03_import_data.py on the cases
the simple regex used to get wrong.

Usage:
    python tests/test_split_sentences.py
"""

import importlib.util
from pathlib import Path

# The script's filename starts with a digit, so import it by path.
SCRIPT = Path(__file__).resolve().parent.parent / 'scripts' / '03_import_data.py'
spec = importlib.util.spec_from_file_location('import_data', SCRIPT)
import_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_data)
split = import_data.split_into_sentences


def test_abbreviations_do_not_split():
    text = "Dr. Smith gave a long talk about faith in God. He said that e.g. prayer and service matter."
    assert split(text) == [
        "Dr. Smith gave a long talk about faith in God.",
        "He said that e.g. prayer and service matter.",
    ]


def test_question_and_exclamation_split():
    text = "Is faith enough to change a life? Yes, it can change every single person who believes!"
    assert split(text) == [
        "Is faith enough to change a life?",
        "Yes, it can change every single person who believes!",
    ]


def test_title_and_place_names_stay_together():
    text = "Mrs. Jones and Mr. Lee visited St. Louis in the spring of 2020."
    assert split(text) == ["Mrs. Jones and Mr. Lee visited St. Louis in the spring of 2020."]


if __name__ == '__main__':
    failures = 0
    for name, test in list(globals().items()):
        if name.startswith('test_') and callable(test):
            try:
                test()
                print(f"PASS {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    if failures:
        raise SystemExit(f"{failures} sentence test(s) failed")
    print("All sentence tests passed")
