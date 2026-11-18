"""Optional schema check: Python 3.11+ and jsonschema 4.x. No network calls."""
import json
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

root = Path(__file__).resolve().parent
schema = json.loads((root / 'state-events.schema.json').read_text())
valid_examples = json.loads((root / 'valid-examples.json').read_text())
invalid_examples = json.loads((root / 'invalid-examples.json').read_text())
checker = FormatChecker()


@checker.checks('date-time', raises=(ValueError, TypeError))
def is_instant(value):
    if not isinstance(value, str):
        return False
    return datetime.fromisoformat(value).tzinfo is not None


Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema, format_checker=checker)
for example in valid_examples:
    validator.validate(example)
for example in invalid_examples:
    if validator.is_valid(example['event']):
        raise AssertionError('Incorrectly accepted: ' + example['case'])
print(f'PASS: {len(valid_examples)} valid, {len(invalid_examples)} invalid examples; Draft 2020-12')
