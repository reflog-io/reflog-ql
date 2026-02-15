/**
 * RQL Demo: validation (red border), autocomplete dropdown, submit → JSON.
 * Schema is loaded from schema.json and editable in the left panel (not bundled with prod code).
 * From javascript/: npm run demo (builds, copies dist into demo/, then serves demo at http://localhost:3000)
 */
import {
  parsePlainText,
  isValidPlainText,
  getSuggestionsAtCursor,
} from './dist/index.js';

const input = document.getElementById('query-input');
const listEl = document.getElementById('autocomplete-list');
const outputEl = document.getElementById('json-output');
const form = document.getElementById('demo-form');
const schemaInput = document.getElementById('schema-input');
const schemaError = document.getElementById('schema-error');

let selectedIndex = -1;
let currentSuggestions = [];
let blurHideTimeout = null;
/** @type {import('./dist/index.js').Schema | null} */
let currentSchema = null;

function setInvalid(valid) {
  input.classList.toggle('invalid', !valid);
}

/**
 * @param {string} raw
 * @returns {import('../dist/index.js').Schema | null}
 */
function parseSchema(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const data = JSON.parse(trimmed);
    if (!data || typeof data !== 'object' || !Array.isArray(data.entities)) {
      return null;
    }
    return { entities: data.entities };
  } catch {
    return null;
  }
}

function updateSchemaFromEditor() {
  const raw = schemaInput.value;
  const parsed = parseSchema(raw);
  if (parsed) {
    currentSchema = parsed;
    schemaInput.classList.remove('invalid');
    schemaError.textContent = '';
  } else {
    const trimmed = raw.trim();
    if (!trimmed) {
      schemaError.textContent = 'Schema is empty. Add valid JSON with an "entities" array.';
    } else {
      try {
        const data = JSON.parse(trimmed);
        if (!data || typeof data !== 'object' || !Array.isArray(data.entities)) {
          schemaError.textContent = 'Schema must have an "entities" array.';
        } else {
          schemaError.textContent = 'Invalid entity definitions in "entities" array.';
        }
      } catch (e) {
        schemaError.textContent = `Invalid JSON: ${e.message}`;
      }
    }
    schemaInput.classList.add('invalid');
    currentSchema = null;
  }
  updateValidity();
  updateAutocomplete();
}

function showSuggestions(suggestions) {
  currentSuggestions = suggestions;
  selectedIndex = -1;
  listEl.innerHTML = '';
  suggestions.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.label;
    li.setAttribute('role', 'option');
    li.setAttribute('data-index', String(i));
    li.addEventListener('click', () => selectSuggestion(i));
    listEl.appendChild(li);
  });
  listEl.hidden = suggestions.length === 0;
}

function selectSuggestion(index) {
  const s = currentSuggestions[index];
  if (!s) return;
  const cursor = input.selectionStart ?? input.value.length;
  const partialLen =
    s.replacePartial !== false && s.replaceLength != null ? s.replaceLength : 0;
  const before = input.value.slice(0, cursor - partialLen);
  const after = input.value.slice(cursor);
  input.value = before + s.insertText + after;
  input.focus();
  const newPos = before.length + s.insertText.length;
  input.setSelectionRange(newPos, newPos);
  updateValidity();
  if (blurHideTimeout) {
    clearTimeout(blurHideTimeout);
    blurHideTimeout = null;
  }
  setTimeout(() => updateAutocomplete(), 0);
}

function highlightSelected() {
  const items = listEl.querySelectorAll('li');
  items.forEach((li, i) => li.classList.toggle('selected', i === selectedIndex));
}

function updateAutocomplete() {
  if (!currentSchema) {
    showSuggestions([]);
    return;
  }
  const cursor = input.selectionStart ?? input.value.length;
  const suggestions = getSuggestionsAtCursor(input.value, cursor, currentSchema);
  showSuggestions(suggestions);
  selectedIndex = -1;
  highlightSelected();
}

function updateValidity() {
  if (!currentSchema) {
    setInvalid(false);
    return;
  }
  setInvalid(isValidPlainText(input.value, currentSchema));
}

// Load initial schema from schema.json
fetch(new URL('schema.json', import.meta.url))
  .then((r) => r.text())
  .then((text) => {
    schemaInput.value = text;
    updateSchemaFromEditor();
  })
  .catch(() => {
    schemaInput.placeholder = 'Failed to load schema.json';
    schemaError.textContent = 'Could not load schema.json. Paste valid schema JSON above.';
  });

schemaInput.addEventListener('input', () => {
  updateSchemaFromEditor();
});

// Input: validate and refresh autocomplete
input.addEventListener('input', () => {
  updateValidity();
  updateAutocomplete();
});
input.addEventListener('focus', () => updateAutocomplete());
input.addEventListener('blur', () => {
  if (blurHideTimeout) clearTimeout(blurHideTimeout);
  blurHideTimeout = setTimeout(() => {
    showSuggestions([]);
    blurHideTimeout = null;
  }, 150);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    if (currentSuggestions.length === 0) return;
    e.preventDefault();
    selectedIndex = Math.min(selectedIndex + 1, currentSuggestions.length - 1);
    highlightSelected();
    return;
  }
  if (e.key === 'ArrowUp') {
    if (currentSuggestions.length === 0) return;
    e.preventDefault();
    selectedIndex = Math.max(selectedIndex - 1, -1);
    highlightSelected();
    return;
  }
  if (e.key === 'Enter' && selectedIndex >= 0 && currentSuggestions[selectedIndex]) {
    e.preventDefault();
    selectSuggestion(selectedIndex);
    return;
  }
  if (e.key === 'Escape') {
    showSuggestions([]);
  }
});

input.addEventListener('click', () => updateAutocomplete());
input.addEventListener('keyup', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') updateAutocomplete();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = input.value.trim();
  outputEl.classList.remove('empty');
  if (!currentSchema) {
    outputEl.textContent = 'Error: Fix the schema (left panel) first.';
    return;
  }
  try {
    const rql = parsePlainText(raw, currentSchema);
    outputEl.textContent = raw === '' ? '{}' : JSON.stringify(rql, null, 2);
  } catch (err) {
    outputEl.textContent = `Error: ${err.message}`;
  }
});
