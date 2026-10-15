/** Author-only import preview. All imported text is rendered via textContent. */
export function bindLoreLibrary(panel, settings, request, signal) {
    const file = panel.querySelector('[data-lore-file]');
    if (!file) return;
    const output = panel.querySelector('[data-lore-preview]');
    const save = panel.querySelector('[data-lore-save]');
    const status = panel.querySelector('[data-lore-status]');
    for (const button of panel.querySelectorAll('[data-lore-export]')) button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const result = await request('export', {libraryId:settings.loreLibraryId,kind:button.dataset.loreExport});
            if(signal.aborted)return;
            const url=URL.createObjectURL(new Blob([result.content],{type:result.name.endsWith('.md')?'text/markdown;charset=utf-8':'application/json'}));
            const link=panel.ownerDocument.createElement('a');link.href=url;link.download=result.name;link.click();
            setTimeout(()=>URL.revokeObjectURL(url),1000);
        } catch(error) {status.textContent=error.message;} finally {button.disabled=false;}
    }, {signal});
    let preview = null, generation = 0;
    const reset = () => { generation++; preview = null; save.disabled = true; output.replaceChildren(); };
    panel.querySelector('[data-setting="loreLibraryId"]').addEventListener('change', reset, { signal });
    const mapping = panel.querySelector('[data-lore-mapping]');
    mapping.addEventListener('input', reset, {signal});
    const showPreview = async () => {
        reset();
        const current = generation, selected = file.files?.[0], libraryId = settings.loreLibraryId;
        if (!selected) return;
        try {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(libraryId)) throw Error('Library ID: use 1–64 letters, digits, hyphens or underscores');
            if (selected.size > 500000) throw Error('Lore file exceeds 500 KB');
            const input = await selected.text();
            const mappingProfile = mapping.value.trim() ? JSON.parse(mapping.value) : undefined;
            const format = mapping.value.trim() ? 'mapped_json' : /\.md$/i.test(selected.name) ? 'markdown' : 'auto';
            const sourceName = selected.name;
            const result = await request('preview', { libraryId, input, format, sourceName, mappingProfile, publicIds: [] });
            if (signal.aborted || current !== generation) return;
            preview = { input, libraryId, format, sourceName, mappingProfile, expectedRevision: result.revision, expectedGeneration: result.generation ?? 0 };
            for (const entry of result.entries) {
                const row = panel.ownerDocument.createElement('label');
                row.className = 'ne-lore-entry';
                const check = panel.ownerDocument.createElement('input');
                check.type = 'checkbox'; check.dataset.loreId = entry.id;
                check.disabled = entry.locked || entry.status !== 'active';
                const description = panel.ownerDocument.createElement('span');
                description.textContent = `${entry.title} · ${entry.status} · ${entry.body.slice(0,300)}`;
                row.append(check, description); output.append(row);
            }
            status.textContent = `${result.report.adapter}: ${result.report.total} entries; all hidden. Select entries to make public. Unsupported: ${result.report.unsupported.length}. ${(result.report.warnings || []).join("; ")}`;
            save.disabled = false;
        } catch (error) { if (current === generation) status.textContent = error.message; }
    };
    file.addEventListener('change', showPreview, {signal});
    panel.querySelector('[data-lore-preview-button]').addEventListener('click', showPreview, {signal});
    save.addEventListener('click', async () => {
        if (!preview) return;
        const current = generation;
        const body = { ...preview, publicIds: [...output.querySelectorAll('input:checked')].map(e => e.dataset.loreId) };
        save.disabled = true;
        try {
            const result = await request('import', body);
            if (signal.aborted || current !== generation) return;
            preview = null;
            status.textContent = `Saved revision ${result.revision}: ${result.report.public} public, ${result.report.hidden} hidden.`;
        } catch (error) { if (current === generation) { status.textContent = error.message; save.disabled = false; } }
    }, { signal });
    panel.querySelector('[data-lore-inspect]').addEventListener('click', async () => {
        reset(); const current = generation;
        try {
            const result = await request(encodeURIComponent(settings.loreLibraryId));
            if (signal.aborted || current !== generation) return;
            status.textContent = `Library revision ${result.revision}. Re-import to change visibility.`;
            for (const entry of result.entries) {
                const row = panel.ownerDocument.createElement('p');
                row.textContent = `${entry.id} · ${entry.title} · ${entry.visibility} · ${entry.status}`;
                output.append(row);
            }
        } catch(error) { if (current === generation) status.textContent = error.message; }
    }, { signal });
}
