export const GRID = 10;
export const MAX_WIRE_LENGTH = 300;
export const ANGLE_SNAP = 5;
export const PORT_RADIUS = 8;
export const WIRE_WIDTH = 5;
export const BODY_FILL = 'rgb(65, 65, 80)';
export const BUTTON_MIN_MS = 300;

export function clamp(value, size, max) {
    return Math.max(0, Math.min(value, max - size));
}

export function snapGrid(value, size, max) {
    const maxPos = max - size;
    const gridSnap = Math.round(value / GRID) * GRID;
    if (Math.abs(value - maxPos) <= Math.abs(value - gridSnap)) {
        return maxPos;
    }
    return clamp(gridSnap, size, max);
}

export function snapAngle(deg) {
    return Math.round(deg / ANGLE_SNAP) * ANGLE_SNAP;
}

export function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

export function circlesOverlap(x1, y1, r1, x2, y2, r2) {
    return dist(x1, y1, x2, y2) <= r1 + r2;
}

export function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function segmentHitsRect(x1, y1, x2, y2, rx, ry, rw, rh, padding = 3) {
    const left = rx + padding;
    const right = rx + rw - padding;
    const top = ry + padding;
    const bottom = ry + rh - padding;
    if (right <= left || bottom <= top) return false;

    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;

    const clip = (p, q) => {
        if (Math.abs(p) < 1e-10) return q >= 0;
        const r = q / p;
        if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
        }
        return true;
    };

    if (!clip(-dx, x1 - left)) return false;
    if (!clip(dx, right - x1)) return false;
    if (!clip(-dy, y1 - top)) return false;
    if (!clip(dy, bottom - y1)) return false;
    return t0 < t1 && t1 > 0.01 && t0 < 0.99;
}

export function pointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) {
        return { dist: dist(px, py, x1, y1), x: x1, y: y1, t: 0 };
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return { dist: dist(px, py, cx, cy), x: cx, y: cy, t };
}

export function raycastRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let tMin = 0;
    let tMax = 1;

    const edges = [
        { p: -dx, q: x1 - rx },
        { p: dx, q: rx + rw - x1 },
        { p: -dy, q: y1 - ry },
        { p: dy, q: ry + rh - y1 }
    ];

    for (const { p, q } of edges) {
        if (Math.abs(p) < 1e-10) {
            if (q < 0) return null;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > tMax) return null;
            if (t > tMin) tMin = t;
        } else {
            if (t < tMin) return null;
            if (t < tMax) tMax = t;
        }
    }

    if (x1 > rx && x1 < rx + rw && y1 > ry && y1 < ry + rh) {
        return 0;
    }

    if (tMin > 0 && tMin <= 1) return tMin;
    return null;
}

export function raycastObjects(x1, y1, x2, y2, objects, attachedObj = null, inset = 1.5) {
    let sx = x1;
    let sy = y1;

    if (attachedObj) {
        const cx = attachedObj.x + attachedObj.w / 2;
        const cy = attachedObj.y + attachedObj.h / 2;
        let odx = sx - cx;
        let ody = sy - cy;
        const od = Math.hypot(odx, ody) || 1;
        sx += (odx / od) * 3;
        sy += (ody / od) * 3;
    }

    let bestT = 1;
    let hit = false;

    for (const obj of objects) {
        const t = raycastRect(sx, sy, x2, y2, obj.x, obj.y, obj.w, obj.h);
        if (t !== null && t < bestT) {
            bestT = t;
            hit = true;
        }
    }

    if (!hit || bestT >= 1) {
        return { x: x2, y: y2 };
    }

    const segLen = Math.max(1, dist(sx, sy, x2, y2));
    const t = Math.max(0, bestT - inset / segLen);
    return {
        x: sx + (x2 - sx) * t,
        y: sy + (y2 - sy) * t
    };
}

export function resolveOverlap(moving, other) {
    const overlapX = Math.min(moving.x + moving.w, other.x + other.w) - Math.max(moving.x, other.x);
    const overlapY = Math.min(moving.y + moving.h, other.y + other.h) - Math.max(moving.y, other.y);
    if (overlapX <= 0 || overlapY <= 0) return;

    if (overlapX < overlapY) {
        const movingCenter = moving.x + moving.w / 2;
        const otherCenter = other.x + other.w / 2;
        if (movingCenter < otherCenter) {
            moving.x = other.x - moving.w;
        } else {
            moving.x = other.x + other.w;
        }
    } else {
        const movingCenter = moving.y + moving.h / 2;
        const otherCenter = other.y + other.h / 2;
        if (movingCenter < otherCenter) {
            moving.y = other.y - moving.h;
        } else {
            moving.y = other.y + other.h;
        }
    }
}

export function wireCrossesAnyObject(wire, objects) {
    const ax = wire.inputPort.x;
    const ay = wire.inputPort.y;
    const bx = wire.outputPort.x;
    const by = wire.outputPort.y;
    for (const obj of objects) {
        if (segmentHitsRect(ax, ay, bx, by, obj.x, obj.y, obj.w, obj.h)) {
            return true;
        }
    }
    return false;
}

export function anyWiresCross(wireList, objects) {
    for (const w of wireList) {
        if (wireCrossesAnyObject(w, objects)) return true;
    }
    return false;
}

export function drawBody(ctx, x, y, w, h) {
    ctx.fillStyle = BODY_FILL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawLabel(ctx, x, y, w, h, text) {
    ctx.fillStyle = '#ddd';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
}
