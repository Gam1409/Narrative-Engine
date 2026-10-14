import { getContext } from '../context/stContext.js';
import { saveCardVisual } from '../visual/cards.js';

export async function editVisualCard(runtime) {
    const context = getContext(),
        index = context.characterId,
        card = context.characters?.[index];
    if (!card) throw new Error('Select a character card first');
    const state = runtime.stateManager.snapshot();
    const entity = Object.values(state.entities || {}).find(
        (item) => item.type === 'character' && item.name === card.name,
    );
    const id = card.data?.extensions?.narrative_engine?.visual?.profile?.entityId || entity?.id || card.name;
    const existing = card.data?.extensions?.narrative_engine?.visual?.profile ||
        (await runtime.visualDirector.profiles())[id] || { entityId: id, appearance: '', lora: [] };
    const dialog = document.createElement('dialog');
    dialog.className = 'ne-visual-card';
    const heading = document.createElement('h3');
    heading.textContent = `Visual identity — ${card.name}`;
    const note = document.createElement('p');
    note.textContent =
        'Saved in this character card. Clothing and its condition remain controlled by the accepted world state.';
    const form = document.createElement('form');
    const field = (label, value, type = 'text') => {
        const wrapper = document.createElement('label');
        wrapper.className = 'ne-field';
        wrapper.append(label);
        const control = document.createElement('input');
        control.type = type;
        control.value = value ?? '';
        control.className = 'text_pole';
        wrapper.append(control);
        return { wrapper, control };
    };
    const entityField = field('World character ID', id);
    const appearance = field('Base appearance', existing.appearance || '');
    form.append(entityField.wrapper, appearance.wrapper);
    const rows = document.createElement('div');
    const records = [];
    function addRow(value = {}) {
        if (records.filter((record) => record.row.isConnected || rows.contains(record.row)).length >= 8) return;
        const row = document.createElement('fieldset');
        const name = field('LoRA filename', value.name || '');
        const weight = field('Model weight', value.weight ?? 0.8, 'number');
        const clip = field('Text encoder weight', value.clipWeight ?? value.weight ?? 0.8, 'number');
        for (const input of [weight.control, clip.control]) {
            input.min = '-2';
            input.max = '2';
            input.step = '0.05';
        }
        const triggers = field('Trigger words', value.triggerWords || '');
        const familyLabel = document.createElement('label');
        familyLabel.className = 'ne-field';
        familyLabel.append('LoRA model family');
        const family = document.createElement('select');
        family.className = 'text_pole';
        for (const [key, label] of [
            ['', 'Select verified family'],
            ['sdxl', 'SDXL'],
            ['pony', 'Pony'],
            ['illustrious', 'Illustrious'],
            ['anima', 'Anima'],
        ]) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = label;
            family.append(option);
        }
        family.value = value.family || '';
        familyLabel.append(family);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove LoRA';
        remove.className = 'menu_button';
        remove.addEventListener('click', () => row.remove());
        row.append(name.wrapper, familyLabel, weight.wrapper, clip.wrapper, triggers.wrapper, remove);
        rows.append(row);
        records.push({
            row,
            name: name.control,
            weight: weight.control,
            clip: clip.control,
            triggers: triggers.control,
            family,
        });
    }
    for (const value of existing.lora || []) addRow(value);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'menu_button';
    add.textContent = 'Add LoRA';
    add.addEventListener('click', () => addRow());
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'menu_button';
    save.textContent = 'Save to character card';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'menu_button';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', () => dialog.close());
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    form.append(rows, add, save, cancel, status);
    dialog.append(heading, note, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        status.textContent = 'Saving…';
        try {
            if (getContext().characters?.[index]?.avatar !== card.avatar)
                throw new Error('Character changed; reopen the editor');
            const entityId = entityField.control.value.trim();
            const current = runtime.stateManager.snapshot();
            if (current.entities?.[entityId]?.type !== 'character' && !current.characters?.[entityId])
                throw new Error('Choose an existing world character ID');
            const lora = records
                .filter((record) => rows.contains(record.row))
                .map((record) => {
                    if (!record.family.value) throw new Error('Select the verified model family for every LoRA');
                    return {
                        name: record.name.value.trim(),
                        weight: Number(record.weight.value),
                        clipWeight: Number(record.clip.value),
                        family: record.family.value,
                        triggerWords: record.triggers.value.trim(),
                    };
                });
            const profile = { ...existing, entityId, appearance: appearance.control.value.trim(), lora };
            await saveCardVisual(context, index, profile);
            runtime.spriteManifests.visualProfiles = await runtime.visualDirector.profiles();
            status.textContent = 'Saved to character card. The next generation will use this profile.';
        } catch (error) {
            status.textContent = error.message;
        } finally {
            save.disabled = false;
        }
    });
    dialog.showModal();
}
