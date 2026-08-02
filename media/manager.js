// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const el = {
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    form: document.getElementById('form'),
    name: document.getElementById('name'),
    distro: document.getElementById('distro'),
    cwd: document.getElementById('cwd'),
    cwdHint: document.getElementById('cwd-hint'),
    commands: document.getElementById('commands'),
    addCommand: document.getElementById('add-command'),
    newProfile: document.getElementById('new'),
    launch: document.getElementById('launch'),
    remove: document.getElementById('delete'),
    dropdown: document.getElementById('dropdown'),
    scope: document.getElementById('scope'),
    scopeHint: document.getElementById('scope-hint'),
  };

  /** @type {{profiles: any[], distros: string[], selected: string|null, originalName: string|null}} */
  let state = { profiles: [], distros: [], selected: null, originalName: null };

  // ------------------------------------------------------------------ render

  function renderList() {
    el.list.innerHTML = '';
    el.empty.style.display = state.profiles.length ? 'none' : 'block';

    for (const profile of state.profiles) {
      const item = document.createElement('li');
      if (profile.name === state.selected) {
        item.className = 'selected';
      }
      const title = document.createElement('span');
      title.textContent = profile.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      const last = profile.commands[profile.commands.length - 1];
      meta.textContent = [profile.distro || 'host shell', (last && (last.run || last)) || 'no commands']
        .filter(Boolean)
        .join(' · ');
      item.appendChild(title);
      item.appendChild(meta);
      item.addEventListener('click', () => select(profile.name));
      el.list.appendChild(item);
    }
  }

  function renderDistros(selected) {
    el.distro.innerHTML = '';
    const host = document.createElement('option');
    host.value = '';
    host.textContent = 'Host shell (no WSL)';
    el.distro.appendChild(host);

    for (const distro of state.distros) {
      const option = document.createElement('option');
      option.value = distro;
      option.textContent = distro + ' (WSL)';
      el.distro.appendChild(option);
    }
    el.distro.value = selected || '';
    updateCwdHint();
  }

  /**
   * Move a path between host and WSL form: D:\\a\\b <-> /mnt/d/a/b.
   * Anything that doesn't match either shape is left alone.
   */
  function convertPath(value, toLinux) {
    const path = value.trim();
    if (!path) {
      return path;
    }
    if (toLinux) {
      const m = path.match(/^([a-zA-Z]):[\\/](.*)$/);
      return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/') : path;
    }
    const m = path.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    return m ? m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\') : path;
  }

  function updateCwdHint() {
    el.cwdHint.textContent = el.distro.value
      ? 'Linux path inside ' + el.distro.value + ', for example /mnt/d/projects/example'
      : 'Path on this machine, for example D:\\projects\\example';
  }

  const DEFAULT_WAIT_MS = 3000;

  /** Accept both the shorthand string form and the {run, waitMs} object form. */
  function toCommand(entry) {
    if (typeof entry === 'string') {
      return { run: entry, waitMs: DEFAULT_WAIT_MS };
    }
    return {
      run: (entry && entry.run) || '',
      waitMs: entry && typeof entry.waitMs === 'number' ? entry.waitMs : DEFAULT_WAIT_MS,
    };
  }

  function renderCommands(commands) {
    el.commands.innerHTML = '';
    commands.forEach((command, index) => addCommandRow(toCommand(command), index));
    if (commands.length === 0) {
      addCommandRow(toCommand(''), 0);
    }
  }

  function addCommandRow(command, index) {
    const row = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'index';
    label.textContent = String(index + 1);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'col-run';
    input.value = command.run;
    input.placeholder = index === 0 ? 'claude --continue' : '';

    const wait = document.createElement('input');
    wait.type = 'number';
    wait.className = 'col-wait';
    wait.min = '0';
    wait.step = '250';
    wait.value = String(command.waitMs);
    wait.title = 'Milliseconds to allow before this command runs';

    const up = iconButton('↑', 'Move up', () => move(row, -1));
    const down = iconButton('↓', 'Move down', () => move(row, 1));
    const remove = iconButton('✕', 'Remove', () => {
      row.remove();
      reindex();
    });

    row.append(label, input, wait, up, down, remove);
    el.commands.appendChild(row);
    reindex();
  }

  function iconButton(glyph, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon';
    button.textContent = glyph;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  function move(row, delta) {
    const rows = [...el.commands.children];
    const index = rows.indexOf(row);
    const target = index + delta;
    if (target < 0 || target >= rows.length) {
      return;
    }
    if (delta < 0) {
      el.commands.insertBefore(row, rows[target]);
    } else {
      el.commands.insertBefore(rows[target], row);
    }
    reindex();
  }

  function reindex() {
    [...el.commands.children].forEach((row, index) => {
      row.querySelector('.index').textContent = String(index + 1);
    });
  }

  // ------------------------------------------------------------------ state

  function select(name) {
    const profile = state.profiles.find((p) => p.name === name);
    if (!profile) {
      return;
    }
    state.selected = name;
    state.originalName = name;
    // Fields this form does not render still belong to the profile. Saving used
    // to emit only what the form knows about, so a hand-authored profile lost
    // its shellPath and shellArgs on any save, including one that changed
    // nothing, and fell back to VS Code's default shell.
    state.carried = carriedFrom(profile);
    el.name.value = profile.name;
    renderDistros(profile.distro);
    el.cwd.value = profile.cwd || '';
    el.dropdown.checked = Boolean(profile.showInDropdown);
    renderScope(name);
    renderCommands(profile.commands || []);
    el.form.classList.remove('hidden');
    renderList();
  }

  /**
   * Show where this profile is saved.
   *
   * Falls back to the configured default for a new one. With no folder open
   * there is nowhere to write workspace settings, so the choice is removed
   * rather than offered and silently ignored.
   */
  function renderScope(name) {
    var value = (name && state.scopes && state.scopes[name]) || state.defaultScope || 'workspace';
    if (!state.canScopeToWorkspace) {
      value = 'global';
    }
    el.scope.value = value;
    el.scope.disabled = !state.canScopeToWorkspace;
    if (el.scopeHint) {
      el.scopeHint.textContent = state.canScopeToWorkspace
        ? 'A profile usually names one project\u2019s directory and runs its commands, so this project is the default. Change it here to move the profile: saving writes it to the new place and removes it from the old.'
        : 'No folder is open, so there is nowhere to write project settings. This profile will be saved globally.';
    }
  }

  /**
   * The parts of a profile the form has no field for.
   *
   * Listed as "everything except what we render" rather than as a fixed set, so
   * a field added to the schema later survives a round trip through this editor
   * without anyone remembering to come back here.
   */
  const RENDERED = ['name', 'distro', 'cwd', 'commands', 'showInDropdown'];

  function carriedFrom(profile) {
    const rest = {};
    for (const key of Object.keys(profile || {})) {
      if (!RENDERED.includes(key)) {
        rest[key] = profile[key];
      }
    }
    return rest;
  }

  function draft(values) {
    state.selected = null;
    state.originalName = null;
    state.carried = carriedFrom(values);
    el.name.value = (values && values.name) || '';
    renderDistros((values && values.distro) || '');
    el.cwd.value = (values && values.cwd) || '';
    el.dropdown.checked = Boolean(values && values.showInDropdown);
    renderScope(null);
    renderCommands((values && values.commands) || []);
    el.form.classList.remove('hidden');
    renderList();
    el.name.focus();
    el.name.select();
  }

  function collect() {
    const commands = [...el.commands.children]
      .map((row) => {
        const run = row.querySelector('input.col-run').value.trim();
        const raw = parseInt(row.querySelector('input.col-wait').value, 10);
        const waitMs = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_WAIT_MS;
        // Keep the shorthand when the wait is the default, so simple profiles
        // stay readable in settings.json.
        return waitMs === DEFAULT_WAIT_MS ? run : { run, waitMs };
      })
      .filter((entry) => (typeof entry === 'string' ? entry.length > 0 : entry.run.length > 0));

    return {
      ...(state.carried || {}),
      name: el.name.value.trim(),
      distro: el.distro.value || undefined,
      cwd: el.cwd.value.trim() || undefined,
      commands,
      showInDropdown: el.dropdown.checked || undefined,
    };
  }

  // ----------------------------------------------------------------- events

  el.newProfile.addEventListener('click', () =>
    vscode.postMessage({ type: 'newDraft' }),
  );
  el.addCommand.addEventListener('click', () =>
    addCommandRow(toCommand(''), el.commands.children.length),
  );
  el.distro.addEventListener('change', () => {
    el.cwd.value = convertPath(el.cwd.value, Boolean(el.distro.value));
    updateCwdHint();
  });

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const profile = collect();
    if (!profile.name) {
      el.name.focus();
      return;
    }
    vscode.postMessage({
      type: 'save',
      profile,
      originalName: state.originalName,
      scope: el.scope.value,
    });
  });

  el.launch.addEventListener('click', () => {
    if (state.originalName) {
      vscode.postMessage({ type: 'launch', name: state.originalName });
    }
  });

  el.remove.addEventListener('click', () => {
    if (state.originalName) {
      vscode.postMessage({ type: 'delete', name: state.originalName });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }
    if (message.type === 'chrome') {
      // The sidebar view already lists profiles; showing a second list here
      // duplicates it and squeezes the form into an unusable width.
      document.querySelector('.layout').classList.toggle('no-list', !message.showList);
      return;
    }
    if (message.type !== 'state') {
      return;
    }
    state.profiles = message.profiles || [];
    state.distros = message.distros || [];
    state.scopes = message.scopes || {};
    state.defaultScope = message.defaultScope || 'workspace';
    state.canScopeToWorkspace = message.canScopeToWorkspace !== false;

    if (message.draft) {
      draft(message.draft);
      return;
    }
    const target = message.select || state.selected;
    if (target && state.profiles.some((p) => p.name === target)) {
      select(target);
    } else if (state.profiles.length > 0) {
      select(state.profiles[0].name);
    } else {
      vscode.postMessage({ type: 'newDraft' });
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
