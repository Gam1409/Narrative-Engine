/** Keep one set of controls mounted while navigating the settings dialog. */
export function bindSettingsWindow(panel, signal) {
    const dialog = panel.closest('#ne-settings-window');
    if (!dialog) return () => {};
    const drawer = dialog.closest('#narrative-engine-drawer');
    const opener = drawer.querySelector('[data-open-ne-settings]');
    const tabs = [...panel.querySelectorAll('[data-ne-tab]')];
    const spine = panel.querySelector('.ne-spine');
    const sections = [...spine.children];
    const pages = tabs.map(tab => {
        const page = panel.ownerDocument.createElement('div');
        page.id = tab.getAttribute('aria-controls');
        page.setAttribute('role', 'tabpanel');
        page.setAttribute('aria-labelledby', tab.id);
        page.className = 'ne-settings-page';
        for (const section of sections.filter(item => item.dataset.neGroup === tab.dataset.neTab)) {
            if (['visual','simulation','diagnostics'].includes(tab.dataset.neTab)) section.open = true;
            page.append(section);
        }
        spine.append(page);
        return page;
    });
    function select(index, focus = false) {
        tabs.forEach((tab, i) => {
            tab.setAttribute('aria-selected', String(i === index));
            tab.tabIndex = i === index ? 0 : -1;
            pages[i].hidden = i !== index;
        });
        spine.scrollTop = 0;
        if (focus) tabs[index].focus();
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(index), {signal});
        tab.addEventListener('keydown', event => {
            const next = {ArrowRight:(index+1)%tabs.length, ArrowLeft:(index+tabs.length-1)%tabs.length, Home:0, End:tabs.length-1}[event.key];
            if (next === undefined) return;
            event.preventDefault(); select(next, true);
        }, {signal});
    });
    select(0);
    opener.addEventListener('click', () => {
        if (!dialog.open) dialog.showModal();
        tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.focus();
    }, {signal});
    panel.querySelector('[data-close-ne-settings]').addEventListener('click', () => dialog.close(), {signal});
    dialog.addEventListener('close', () => opener.focus(), {signal});
    return () => {
        if (dialog.open) dialog.close();
        // Allow the same template to be rebound without duplicate tab panels.
        for (const section of sections) spine.append(section);
        for (const page of pages) page.remove();
    };
}
