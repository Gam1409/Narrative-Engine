import { getContext, getChatFingerprint } from '../context/stContext.js';
import { assetUrl } from '../visual/layers.js';

export async function editVisualAnchor(runtime) {
    const director = runtime.visualDirector,
        chatId = getChatFingerprint(getContext());
    const active = () =>
        !director.closed && getChatFingerprint(getContext()) === chatId;
    const assets = (await director.api(`assets/${chatId}`)).filter(
        (a) => a.operation === 'sprite' && a.anchorKey,
    );
    if (!active()) return 'Chat changed';
    if (!assets.length) throw Error('Generate an integrated sprite first');
    const dialog = document.createElement('dialog');
    dialog.className = 'ne-visual-card';
    const title = document.createElement('h3');
    title.textContent = 'Sprite face anchor';
    const note = document.createElement('p');
    note.textContent =
        'Automatic detection normally selects the face. To correct it, drag a rectangle around the face only. Outfit, pose and identity must match future requests.';
    const select = document.createElement('select');
    select.className = 'text_pole';
    for (const a of assets) {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = `${a.characterId} — ${new Date(a.createdAt).toLocaleString()}`;
        select.append(o);
    }
    const canvas = document.createElement('canvas');
    canvas.style.maxWidth = '100%';
    canvas.style.touchAction = 'none';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Use this face anchor';
    save.className = 'menu_button';
    save.disabled = true;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove matching anchor';
    remove.className = 'menu_button';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.className = 'menu_button';
    close.onclick = () => dialog.close();
    let image,
        face,
        start,
        revision = 0;
    const draw = () => {
        const c = canvas.getContext('2d');
        c.clearRect(0, 0, canvas.width, canvas.height);
        if (image) c.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (face) {
            c.strokeStyle = '#ff4040';
            c.lineWidth = 2;
            c.strokeRect(
                (face.x * canvas.width) / image.naturalWidth,
                (face.y * canvas.height) / image.naturalHeight,
                (face.width * canvas.width) / image.naturalWidth,
                (face.height * canvas.height) / image.naturalHeight,
            );
        }
    };
    const load = async () => {
        const rev = ++revision;
        face = null;
        image = null;
        save.disabled = true;
        const img = new Image();
        img.src = assetUrl(chatId, select.value);
        await img.decode();
        if (rev !== revision || !active() || !dialog.isConnected) return;
        image = img;
        canvas.width = Math.min(512, img.naturalWidth);
        canvas.height = Math.round(
            (img.naturalHeight * canvas.width) / img.naturalWidth,
        );
        const anchors = await director.api(`anchors/${chatId}`);
        if (rev !== revision || !active()) return;
        const anchor = anchors.find((a) => a.assetId === select.value);
        face = anchor?.face || null;
        save.disabled = !face;
        status.textContent = face
            ? 'Saved face area loaded.'
            : 'Drag to select the face.';
        draw();
    };
    const point = (e) => {
        const r = canvas.getBoundingClientRect();
        return {
            x: Math.max(
                0,
                Math.min(
                    image.naturalWidth,
                    Math.round(
                        ((e.clientX - r.left) / r.width) * image.naturalWidth,
                    ),
                ),
            ),
            y: Math.max(
                0,
                Math.min(
                    image.naturalHeight,
                    Math.round(
                        ((e.clientY - r.top) / r.height) * image.naturalHeight,
                    ),
                ),
            ),
        };
    };
    canvas.onpointerdown = (e) => {
        if (!image) return;
        start = point(e);
        canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
        if (!start || !image) return;
        const end = point(e);
        face = {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(start.x - end.x),
            height: Math.abs(start.y - end.y),
        };
        draw();
    };
    canvas.onpointerup = () => {
        start = null;
        save.disabled = !face || face.width < 16 || face.height < 16;
    };
    const change = async (fn) => {
        try {
            if (!active()) throw Error('Chat changed');
            save.disabled = true;
            await fn();
            if (!active()) return;
            status.textContent = 'Saved. Updating current layers.';
            await director.request({ layers: true });
        } catch (e) {
            status.textContent = e.message;
        } finally {
            save.disabled = !face;
        }
    };
    save.onclick = () =>
        change(() =>
            director.api('anchors', { chatId, assetId: select.value, face }),
        );
    remove.onclick = () =>
        change(() =>
            director.api('anchors/remove', {
                chatId,
                key: assets.find((a) => a.id === select.value).anchorKey,
            }),
        );
    select.onchange = () =>
        load().catch((e) => (status.textContent = e.message));
    dialog.append(title, note, select, canvas, status, save, remove, close);
    document.body.append(dialog);
    dialog.addEventListener(
        'close',
        () => {
            revision++;
            dialog.remove();
        },
        { once: true },
    );
    dialog.showModal();
    await load();
    return 'Sprite anchor editor opened';
}
