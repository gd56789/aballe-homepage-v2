/**
 * ABALLE Interactive Logo — Auto-Reveal + Click to Transform
 *
 * Logo assembles automatically on page load from scattered lines.
 * Click to morph: logo lines split into vertebra fragments, drift, reassemble.
 */

class AballeRevealArt {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        // Interaction state
        this.mouse = new THREE.Vector2(9999, 9999);
        this.mouseWorld = new THREE.Vector3(9999, 9999, 0);
        this.isInteracting = false;

        // Auto-reveal state (replaces scroll-based reveal)
        this.autoRevealProgress = 0;
        this.autoRevealComplete = false;
        this.autoRevealTime = 0;
        this.autoRevealDuration = 1.9;   // seconds to assemble (faster)
        this.autoRevealDelay = 0.1;      // brief pause showing scattered state (faster)

        // Artwork swap state
        this.currentArtwork = 'logo';
        this.isSwapping = false;
        this.swapProgress = 1;
        this.swapToPositions = [];

        // Both artwork datasets (pre-loaded)
        // rawPaths stores unscaled data, svgPaths stores scaled positions
        this.artworks = {
            logo: { svgPaths: [], rawPaths: [], file: 'logo.svg', svgWidth: 0, svgHeight: 0 },
            vertebra: { svgPaths: [], rawPaths: [], file: 'vertebra.svg', svgWidth: 0, svgHeight: 0 }
        };

        // Scattered positions for initial reveal only
        this.scatteredPositions = [];

        // Max lines we'll ever need (determined after loading both SVGs)
        this.maxLineCount = 0;

        // Configuration
        this.config = {
            maxLines: 0,                // 0 = no limit, use all paths from SVG
            repelRadius: 100,           // Mouse repel effect radius
            repelStrength: 40,          // Mouse repel effect strength
            returnSpeed: 0.04,
            baseColor: new THREE.Color(0xffffff),
            accentColor: new THREE.Color(0xffd700),
            backgroundColor: 0x0a0a0a,
            pulseEnabled: true,         // Subtle breathing effect
            pulseSpeed: 0.8,
            pulseAmount: 0.015,
            energyLineCount: 4,
            energyLineOpacity: 0.5,
            swapDuration: 4.0,          // Total transition time
            scatterRadius: 600,
            disassembleDistance: 120,    // How far pieces drift apart
            disassembleDrift: 15,       // Subtle floating drift during hang
            splitDistance: 30           // How far children fan out during split
        };

        this.time = 0;

        // Line rendering data — pre-allocated for maxLineCount
        this.lines = [];
        this.originalPositions = [];
        this.currentPositions = [];
        this.velocities = [];

        this.artGroup = new THREE.Group();
        this.energyLines = [];

        this.init();
    }

    async init() {
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();

        // Load both SVGs in parallel
        await Promise.all([
            this.loadSVG('logo'),
            this.loadSVG('vertebra')
        ]);

        // Determine max line count across both artworks
        this.maxLineCount = Math.max(
            this.artworks.logo.svgPaths.length,
            this.artworks.vertebra.svgPaths.length
        );

        // Pre-allocate ALL lines with the max point count per line
        this.preallocateLines();

        // Set initial artwork to logo
        this.setArtworkTargets('logo');
        this.generateScatteredPositions();

        // Start at scattered positions (only for visible/active lines)
        for (let i = 0; i < this.maxLineCount; i++) {
            if (this.lines[i].visible) {
                for (let j = 0; j < this.currentPositions[i].length; j++) {
                    if (this.scatteredPositions[i] && this.scatteredPositions[i][j]) {
                        this.currentPositions[i][j].copy(this.scatteredPositions[i][j]);
                    }
                }
            }
            // All lines start at opacity 0
            this.lines[i].material.opacity = 0;
        }

        this.createEnergyLines();
        this.setupEventListeners();
        this.animate();
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.config.backgroundColor);
        this.scene.add(this.artGroup);
    }

    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 3000);
        this.camera.position.z = 800;
    }

    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);
    }

    async loadSVG(artworkKey) {
        const artwork = this.artworks[artworkKey];
        try {
            const response = await fetch(artwork.file);
            const svgText = await response.text();

            // Parse SVG using DOMParser (safer than innerHTML)
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgText, 'image/svg+xml');
            const svg = doc.querySelector('svg');

            // Need to render SVG to get path lengths - create hidden container
            const hiddenDiv = document.createElement('div');
            hiddenDiv.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:500px;height:500px;opacity:0;pointer-events:none';
            hiddenDiv.appendChild(svg.cloneNode(true));
            document.body.appendChild(hiddenDiv);
            hiddenDiv.offsetHeight; // Force layout

            const renderedSvg = hiddenDiv.querySelector('svg');
            const viewBox = renderedSvg.getAttribute('viewBox').split(' ').map(Number);
            artwork.svgWidth = viewBox[2];
            artwork.svgHeight = viewBox[3];

            // Store RAW unscaled paths (centered around origin)
            artwork.rawPaths = [];

            const sampleElement = (element) => {
                try {
                    const pathLength = element.getTotalLength();
                    if (pathLength <= 0) return;
                    const numPoints = Math.max(20, Math.min(150, Math.ceil(pathLength / 2)));
                    const pathPoints = [];
                    for (let i = 0; i <= numPoints; i++) {
                        const t = i / numPoints;
                        const point = element.getPointAtLength(t * pathLength);
                        // Store centered but unscaled
                        pathPoints.push({
                            x: point.x - artwork.svgWidth / 2,
                            y: -(point.y - artwork.svgHeight / 2),
                            z: 0
                        });
                    }
                    artwork.rawPaths.push(pathPoints);
                } catch (e) {}
            };

            renderedSvg.querySelectorAll('path').forEach(sampleElement);
            renderedSvg.querySelectorAll('polygon').forEach(sampleElement);
            renderedSvg.querySelectorAll('polyline').forEach(sampleElement);
            renderedSvg.querySelectorAll('rect').forEach(sampleElement);
            renderedSvg.querySelectorAll('circle').forEach(sampleElement);
            renderedSvg.querySelectorAll('ellipse').forEach(sampleElement);
            renderedSvg.querySelectorAll('line').forEach(sampleElement);

            // Optionally limit to maxLines (0 = no limit, use all paths)
            const maxLines = this.config.maxLines;
            if (maxLines > 0 && artwork.rawPaths.length > maxLines) {
                const scored = artwork.rawPaths.map((path, idx) => {
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const p of path) {
                        if (p.x < minX) minX = p.x;
                        if (p.x > maxX) maxX = p.x;
                        if (p.y < minY) minY = p.y;
                        if (p.y > maxY) maxY = p.y;
                    }
                    const size = (maxX - minX) + (maxY - minY);
                    return { path, size, idx };
                });
                scored.sort((a, b) => b.size - a.size);
                const top = scored.slice(0, maxLines);
                top.sort((a, b) => a.idx - b.idx);
                artwork.rawPaths = top.map(s => s.path);
            }

            // Apply initial scale
            this.applyScale(artworkKey);

            document.body.removeChild(hiddenDiv);
            console.log(`${artworkKey}: ${artwork.rawPaths.length} shapes (from SVG)`);
        } catch (error) {
            console.error(`Could not load ${artwork.file}:`, error);
        }
    }

    // Calculate and apply scale for an artwork based on current viewport
    applyScale(artworkKey) {
        const artwork = this.artworks[artworkKey];
        if (!artwork.rawPaths.length) return;

        const isMobile = this.width < 768;
        let scale;

        if (artworkKey === 'logo') {
            // LOGO: On mobile, fill width with 10px padding each side
            // On desktop, use balanced scaling
            if (isMobile) {
                const targetWidth = this.width - 20; // 10px padding each side
                scale = targetWidth / artwork.svgWidth;
            } else {
                const padding = 80;
                const availableWidth = this.width - padding * 2;
                const availableHeight = this.height - padding * 2;
                const scaleX = availableWidth / artwork.svgWidth;
                const scaleY = availableHeight / artwork.svgHeight;
                scale = Math.min(scaleX, scaleY) * 0.55;
            }
        } else {
            // VERTEBRA: Fit within screen without overflow (use smaller of width/height scale)
            if (isMobile) {
                const paddingX = 20; // 10px each side
                const paddingY = 40; // some vertical breathing room
                const scaleX = (this.width - paddingX) / artwork.svgWidth;
                const scaleY = (this.height - paddingY) / artwork.svgHeight;
                scale = Math.min(scaleX, scaleY);
            } else {
                const padding = 80;
                const availableWidth = this.width - padding * 2;
                const availableHeight = this.height - padding * 2;
                const scaleX = availableWidth / artwork.svgWidth;
                const scaleY = availableHeight / artwork.svgHeight;
                scale = Math.min(scaleX, scaleY) * 0.55;
            }
        }

        // Apply scale to create svgPaths from rawPaths
        artwork.svgPaths = artwork.rawPaths.map(rawPath =>
            rawPath.map(p => ({
                x: p.x * scale,
                y: p.y * scale,
                z: p.z
            }))
        );
    }

    // Recalculate all scales (called on resize)
    recalculateScales() {
        this.applyScale('logo');
        this.applyScale('vertebra');

        // Update max line count (shouldn't change, but be safe)
        this.maxLineCount = Math.max(
            this.artworks.logo.svgPaths.length,
            this.artworks.vertebra.svgPaths.length
        );

        // Update current artwork targets
        this.setArtworkTargets(this.currentArtwork);

        // If not currently swapping, snap to new positions
        if (!this.isSwapping && this.autoRevealComplete) {
            for (let i = 0; i < this.maxLineCount; i++) {
                for (let j = 0; j < this.maxPointsPerLine; j++) {
                    this.currentPositions[i][j].copy(this.originalPositions[i][j]);
                }
                this.updateLineGeometry(i);
            }
        }
    }

    // Pre-allocate all Three.js line objects with enough points for any artwork
    preallocateLines() {
        let maxPointsPerLine = 0;
        for (const key of ['logo', 'vertebra']) {
            for (const path of this.artworks[key].svgPaths) {
                maxPointsPerLine = Math.max(maxPointsPerLine, path.length);
            }
        }
        maxPointsPerLine = Math.max(maxPointsPerLine, 30);
        this.maxPointsPerLine = maxPointsPerLine;

        for (let i = 0; i < this.maxLineCount; i++) {
            const linePoints = [];
            const originalPoints = [];
            const velocityPoints = [];

            for (let j = 0; j < maxPointsPerLine; j++) {
                linePoints.push(new THREE.Vector3(0, 0, 0));
                originalPoints.push(new THREE.Vector3(0, 0, 0));
                velocityPoints.push(new THREE.Vector3(0, 0, 0));
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            const material = new THREE.LineBasicMaterial({
                color: this.config.baseColor,
                transparent: true,
                opacity: 0.8
            });

            const line = new THREE.Line(geometry, material);
            this.artGroup.add(line);

            this.lines.push({
                mesh: line, geometry, material,
                baseOpacity: 0.8,
                activePointCount: 0,
                visible: true
            });
            this.originalPositions.push(originalPoints);
            this.currentPositions.push(linePoints);
            this.velocities.push(velocityPoints);
        }
    }

    // Set target positions from an artwork — collapses unused lines to a point
    setArtworkTargets(artworkKey) {
        const paths = this.artworks[artworkKey].svgPaths;

        for (let i = 0; i < this.maxLineCount; i++) {
            if (i < paths.length) {
                const path = paths[i];
                const pointCount = path.length;
                this.lines[i].activePointCount = pointCount;
                this.lines[i].visible = true;

                for (let j = 0; j < this.maxPointsPerLine; j++) {
                    if (j < pointCount) {
                        this.originalPositions[i][j].set(path[j].x, path[j].y, path[j].z);
                    } else {
                        const last = path[pointCount - 1];
                        this.originalPositions[i][j].set(last.x, last.y, last.z);
                    }
                }
            } else {
                this.lines[i].activePointCount = 0;
                this.lines[i].visible = false;

                for (let j = 0; j < this.maxPointsPerLine; j++) {
                    this.originalPositions[i][j].set(0, 0, 0);
                }
            }
        }
    }

    generateScatteredPositions() {
        this.scatteredPositions = [];
        const r = this.config.scatterRadius;

        for (let i = 0; i < this.maxLineCount; i++) {
            const scattered = [];
            const activeCount = this.lines[i].activePointCount;

            for (let j = 0; j < this.maxPointsPerLine; j++) {
                const orig = this.originalPositions[i][j];

                if (this.lines[i].visible && j < activeCount) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = r * (0.4 + Math.random() * 0.6);
                    scattered.push(new THREE.Vector3(
                        orig.x + Math.cos(angle) * dist,
                        orig.y + Math.sin(angle) * dist,
                        (Math.random() - 0.5) * 150
                    ));
                } else {
                    scattered.push(orig.clone());
                }
            }
            this.scatteredPositions.push(scattered);
        }
    }

    // ---- Auto-reveal (time-based, replaces scroll) ----

    updateAutoReveal(dt) {
        if (this.autoRevealComplete) return;

        this.autoRevealTime += dt;

        // Brief delay before animation starts
        const elapsed = this.autoRevealTime - this.autoRevealDelay;
        if (elapsed < 0) {
            // Still in delay — show scattered lines fading in
            const delayT = this.autoRevealTime / this.autoRevealDelay;
            for (let i = 0; i < this.maxLineCount; i++) {
                if (!this.lines[i].visible) {
                    this.lines[i].material.opacity = 0;
                    continue;
                }
                this.lines[i].material.opacity = delayT * 0.15; // very subtle fade-in during delay
            }
            return;
        }

        this.autoRevealProgress = Math.min(elapsed / this.autoRevealDuration, 1);
        const t = this.easeInOutCubic(this.autoRevealProgress);

        for (let i = 0; i < this.maxLineCount; i++) {
            if (!this.lines[i].visible) {
                this.lines[i].material.opacity = 0;
                continue;
            }

            if (!this.scatteredPositions[i]) continue;

            for (let j = 0; j < this.maxPointsPerLine; j++) {
                const scattered = this.scatteredPositions[i][j];
                const target = this.originalPositions[i][j];
                if (!scattered || !target) continue;

                this.currentPositions[i][j].x = scattered.x + (target.x - scattered.x) * t;
                this.currentPositions[i][j].y = scattered.y + (target.y - scattered.y) * t;
                this.currentPositions[i][j].z = scattered.z + (target.z - scattered.z) * t;
            }

            this.updateLineGeometry(i);

            // Opacity ramps faster than position — full at ~60% of reveal
            this.lines[i].material.opacity = Math.min(1, t * 1.6) * 0.8;
        }

        // Mark reveal complete (no click hint)
        if (this.autoRevealProgress >= 1) {
            this.autoRevealComplete = true;
        }
    }

    // ---- Click to swap artwork (split + drift + reassemble) ----

    // Find the nearest logo line to a given point
    findNearestLogoLine(x, y, logoPaths) {
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < logoPaths.length; i++) {
            const path = logoPaths[i];
            let cx = 0, cy = 0;
            for (const p of path) { cx += p.x; cy += p.y; }
            cx /= path.length; cy /= path.length;
            const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        return bestIdx;
    }

    swapArtwork() {
        if (this.isSwapping) return;

        const newArtwork = this.currentArtwork === 'logo' ? 'vertebra' : 'logo';
        const oldArtworkKey = this.currentArtwork;
        const oldPaths = this.artworks[oldArtworkKey].svgPaths;
        const newPaths = this.artworks[newArtwork].svgPaths;
        const oldPathCount = oldPaths.length;
        const newPathCount = newPaths.length;

        // Determine direction
        const isLogoToVertebra = oldArtworkKey === 'logo';
        const logoPaths = isLogoToVertebra ? oldPaths : newPaths;
        const vertebraPaths = isLogoToVertebra ? newPaths : oldPaths;

        // BEFORE changing targets, snapshot every line's current on-screen position
        const currentSnapshot = [];
        for (let i = 0; i < this.maxLineCount; i++) {
            const snap = [];
            for (let j = 0; j < this.maxPointsPerLine; j++) {
                snap.push(this.currentPositions[i][j].clone());
            }
            currentSnapshot.push(snap);
        }

        // Now set targets to new artwork
        this.setArtworkTargets(newArtwork);

        // Snapshot new targets as final positions
        this.swapToPositions = [];
        for (let i = 0; i < this.maxLineCount; i++) {
            const toLine = [];
            for (let j = 0; j < this.maxPointsPerLine; j++) {
                toLine.push(this.originalPositions[i][j].clone());
            }
            this.swapToPositions.push(toLine);
        }

        // Map each vertebra line to its nearest parent logo line (by center distance)
        this.lineParentMap = [];
        for (let i = 0; i < this.maxLineCount; i++) {
            if (i < vertebraPaths.length) {
                const path = vertebraPaths[i];
                let cx = 0, cy = 0;
                for (const p of path) { cx += p.x; cy += p.y; }
                cx /= path.length; cy /= path.length;
                this.lineParentMap.push(this.findNearestLogoLine(cx, cy, logoPaths));
            } else {
                this.lineParentMap.push(0);
            }
        }

        // Count siblings per parent and assign sibling indices
        const parentChildCounts = {};
        const siblingIndex = [];
        for (let i = 0; i < this.maxLineCount; i++) {
            const p = this.lineParentMap[i];
            if (!parentChildCounts[p]) parentChildCounts[p] = 0;
            siblingIndex.push(parentChildCounts[p]);
            parentChildCounts[p]++;
        }
        this.siblingIndex = siblingIndex;
        this.parentChildCounts = parentChildCounts;

        // Compute split offsets: perpendicular fan-out from parent logo line direction
        this.splitOffsets = [];
        const splitDist = this.config.splitDistance;

        for (let i = 0; i < this.maxLineCount; i++) {
            const parentIdx = this.lineParentMap[i];
            if (parentIdx < logoPaths.length) {
                const parentPath = logoPaths[parentIdx];
                // Direction along the parent line
                const first = parentPath[0];
                const last = parentPath[parentPath.length - 1];
                let dx = last.x - first.x;
                let dy = last.y - first.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                dx /= len; dy /= len;
                // Perpendicular direction
                const perpX = -dy;
                const perpY = dx;

                const siblings = parentChildCounts[parentIdx] || 1;
                const k = siblingIndex[i];
                // Fan out: -1 to 1 spread
                const spread = siblings > 1 ? (k / (siblings - 1) - 0.5) * 2 : 0;
                this.splitOffsets.push({
                    x: perpX * spread * splitDist,
                    y: perpY * spread * splitDist
                });
            } else {
                this.splitOffsets.push({ x: 0, y: 0 });
            }
        }

        // Build start positions based on direction
        this.swapStartPositions = [];

        if (isLogoToVertebra) {
            // LOGO → VERTEBRA: all 644 lines start stacked on their parent logo line
            for (let i = 0; i < this.maxLineCount; i++) {
                const startLine = [];
                const parentIdx = this.lineParentMap[i];
                if (parentIdx < oldPathCount) {
                    const parentSnap = currentSnapshot[parentIdx];
                    const parentActiveCount = Math.max(1, oldPaths[parentIdx].length);
                    for (let j = 0; j < this.maxPointsPerLine; j++) {
                        const t = parentActiveCount > 1 ? j / (this.maxPointsPerLine - 1) : 0;
                        const srcIdx = Math.min(Math.floor(t * (parentActiveCount - 1)), parentActiveCount - 1);
                        startLine.push(parentSnap[srcIdx].clone());
                    }
                } else {
                    for (let j = 0; j < this.maxPointsPerLine; j++) {
                        startLine.push(new THREE.Vector3(0, 0, 0));
                    }
                }
                this.swapStartPositions.push(startLine);
            }

        } else {
            // VERTEBRA → LOGO: all lines start from current on-screen positions
            for (let i = 0; i < this.maxLineCount; i++) {
                const startLine = [];
                for (let j = 0; j < this.maxPointsPerLine; j++) {
                    startLine.push(currentSnapshot[i][j].clone());
                }
                this.swapStartPositions.push(startLine);
            }

            // Override final positions:
            // Lines 0-54 (logo lines): target their OWN logo positions (already set by setArtworkTargets)
            // Lines 55-643 (extra vertebra lines): collapse onto their parent logo lines
            for (let i = newPathCount; i < this.maxLineCount; i++) {
                const parentIdx = this.lineParentMap[i];
                if (parentIdx < newPathCount) {
                    const logoPath = logoPaths[parentIdx];
                    const logoActiveCount = Math.max(1, logoPath.length);
                    for (let j = 0; j < this.maxPointsPerLine; j++) {
                        const t = logoActiveCount > 1 ? j / (this.maxPointsPerLine - 1) : 0;
                        const srcIdx = Math.min(Math.floor(t * (logoActiveCount - 1)), logoActiveCount - 1);
                        this.swapToPositions[i][j].set(logoPath[srcIdx].x, logoPath[srcIdx].y, logoPath[srcIdx].z || 0);
                    }
                }
            }
        }

        // Make ALL lines visible and active during the swap
        const maxActive = Math.max(oldPathCount, newPathCount);
        for (let i = 0; i < maxActive; i++) {
            this.lines[i].visible = true;
            if (this.lines[i].activePointCount === 0) {
                this.lines[i].activePointCount = this.maxPointsPerLine;
            }
        }

        // Generate mid-positions: each line drifts to a random scattered position
        this.shatteredSwapPositions = [];
        const driftDist = this.config.disassembleDistance;

        for (let i = 0; i < this.maxLineCount; i++) {
            const shatterLine = [];
            const angle = Math.random() * Math.PI * 2;
            const lineDrift = driftDist * (0.3 + Math.random() * 1.0);
            const driftX = Math.cos(angle) * lineDrift;
            const driftY = Math.sin(angle) * lineDrift;
            const driftZ = (Math.random() - 0.5) * 15;

            for (let j = 0; j < this.maxPointsPerLine; j++) {
                const s = this.swapStartPositions[i][j];
                const e = this.swapToPositions[i][j];
                shatterLine.push(new THREE.Vector3(
                    (s.x + e.x) * 0.5 + driftX,
                    (s.y + e.y) * 0.5 + driftY,
                    driftZ
                ));
            }
            this.shatteredSwapPositions.push(shatterLine);
        }

        this.swapOldPathCount = oldPathCount;
        this.swapNewPathCount = newPathCount;
        this.swapIsLogoToVertebra = isLogoToVertebra;
        this.swapMaxActive = maxActive;
        this.swapLogoPathCount = logoPaths.length;

        // Initialize all lines to their start positions immediately
        for (let i = 0; i < this.maxLineCount; i++) {
            for (let j = 0; j < this.maxPointsPerLine; j++) {
                this.currentPositions[i][j].copy(this.swapStartPositions[i][j]);
            }
            this.updateLineGeometry(i);
            if (i < maxActive) {
                // Keep current opacity for lines that were visible in the old artwork
                const wasVisible = i < oldPathCount;
                this.lines[i].material.opacity = wasVisible ? 0.8 : 0;
            } else {
                this.lines[i].material.opacity = 0;
            }
        }

        this.currentArtwork = newArtwork;
        this.isSwapping = true;
        this.swapProgress = 0;
    }

    // Hero speed curve: maps linear time to fast→slow→fast
    heroSpeedCurve(t) {
        if (t < 0.12) {
            return (t / 0.12) * 0.3;
        } else if (t < 0.65) {
            return 0.3 + ((t - 0.12) / 0.53) * 0.3;
        } else {
            return 0.6 + ((t - 0.65) / 0.35) * 0.4;
        }
    }

    updateSwap(dt) {
        if (!this.isSwapping) return;

        this.swapProgress += dt / this.config.swapDuration;
        if (this.swapProgress >= 1) {
            this.swapProgress = 1;
            this.isSwapping = false;

            // Re-apply final artwork targets to fix visible/activePointCount
            this.setArtworkTargets(this.currentArtwork);

            // Snap to final positions and set correct opacity/color
            for (let i = 0; i < this.maxLineCount; i++) {
                for (let j = 0; j < this.maxPointsPerLine; j++) {
                    this.currentPositions[i][j].copy(this.originalPositions[i][j]);
                }
                this.updateLineGeometry(i);
                this.lines[i].material.opacity = this.lines[i].visible ? 0.8 : 0;
                this.lines[i].material.color.copy(this.config.baseColor);
                this.lines[i].baseOpacity = this.lines[i].visible ? 0.8 : 0;
            }
            return;
        }

        // Apply hero speed curve
        const rawT = this.swapProgress;
        const p = this.heroSpeedCurve(rawT);

        // Phase boundaries (in warped progress p):
        const breakEnd = 0.30;
        const driftEnd = 0.60;
        const driftAmount = this.config.disassembleDrift;
        const isL2V = this.swapIsLogoToVertebra;

        for (let i = 0; i < this.maxLineCount; i++) {
            for (let j = 0; j < this.maxPointsPerLine; j++) {
                const start = this.swapStartPositions[i][j];
                const scattered = this.shatteredSwapPositions[i][j];
                const target = this.swapToPositions[i][j];

                if (p < breakEnd) {
                    // PHASE 1: BREAK
                    const bp = p / breakEnd; // 0→1 within break phase

                    if (isL2V) {
                        // LOGO→VERTEBRA: visible split — children fan out from parent, then drift
                        const splitOffset = this.splitOffsets[i];

                        // Sub-stage A: SPLIT (0→50% of break) — fan out perpendicular
                        const splitT = Math.min(bp / 0.5, 1);
                        const splitEase = 1 - Math.pow(1 - splitT, 3); // ease-out cubic

                        // Sub-stage B: DRIFT AWAY (30%→100% of break) — blend toward shattered
                        const driftT = Math.max(0, (bp - 0.3) / 0.7);
                        const driftEase = 1 - Math.pow(1 - driftT, 3); // ease-out cubic

                        // Base: parent position + split offset
                        const splitX = start.x + splitOffset.x * splitEase;
                        const splitY = start.y + splitOffset.y * splitEase;
                        const splitZ = start.z;

                        // Blend from split position toward shattered position
                        this.currentPositions[i][j].x = splitX + (scattered.x - splitX) * driftEase;
                        this.currentPositions[i][j].y = splitY + (scattered.y - splitY) * driftEase;
                        this.currentPositions[i][j].z = splitZ + (scattered.z - splitZ) * driftEase;
                    } else {
                        // VERTEBRA→LOGO: normal break — snap outward
                        const ease = 1 - Math.pow(1 - bp, 3);
                        this.currentPositions[i][j].x = start.x + (scattered.x - start.x) * ease;
                        this.currentPositions[i][j].y = start.y + (scattered.y - start.y) * ease;
                        this.currentPositions[i][j].z = start.z + (scattered.z - start.z) * ease;
                    }

                } else if (p < driftEnd) {
                    // PHASE 2: SLOW-MO DRIFT — pieces floating, subtle breathing
                    const t = (p - breakEnd) / (driftEnd - breakEnd);
                    // Envelope ensures drift offsets are 0 at boundaries (smooth transitions)
                    const envelope = Math.sin(t * Math.PI);
                    const breathe = Math.sin(t * Math.PI * 2.0) * driftAmount * envelope;
                    const sway = Math.cos(t * Math.PI * 1.5) * driftAmount * 0.5 * envelope;
                    this.currentPositions[i][j].x = scattered.x + Math.sin(i * 0.37 + j * 0.13) * breathe;
                    this.currentPositions[i][j].y = scattered.y + Math.cos(i * 0.29 + j * 0.17) * sway;
                    this.currentPositions[i][j].z = scattered.z + envelope * 5;

                } else {
                    // PHASE 3: REASSEMBLE
                    const rp = (p - driftEnd) / (1 - driftEnd); // 0→1 within reassemble

                    if (!isL2V) {
                        // VERTEBRA→LOGO: converging merge — siblings collapse together
                        const splitOffset = this.splitOffsets[i];
                        const ease = rp < 0.5
                            ? 4 * rp * rp * rp
                            : 1 - Math.pow(-2 * rp + 2, 3) / 2;

                        // Split offset shrinks throughout the entire reassemble phase
                        // Use ease-in-out so it starts gently, accelerates, then finishes smoothly
                        const mergeEase = rp < 0.5
                            ? 2 * rp * rp
                            : 1 - Math.pow(-2 * rp + 2, 2) / 2;

                        // Target with diminishing split offset (shrinks from full → 0)
                        const mergedX = target.x + splitOffset.x * (1 - mergeEase);
                        const mergedY = target.y + splitOffset.y * (1 - mergeEase);

                        this.currentPositions[i][j].x = scattered.x + (mergedX - scattered.x) * ease;
                        this.currentPositions[i][j].y = scattered.y + (mergedY - scattered.y) * ease;
                        this.currentPositions[i][j].z = scattered.z + (target.z - scattered.z) * ease;
                    } else {
                        // LOGO→VERTEBRA: normal reassemble into vertebra shape
                        const ease = rp < 0.5
                            ? 4 * rp * rp * rp
                            : 1 - Math.pow(-2 * rp + 2, 3) / 2;
                        this.currentPositions[i][j].x = scattered.x + (target.x - scattered.x) * ease;
                        this.currentPositions[i][j].y = scattered.y + (target.y - scattered.y) * ease;
                        this.currentPositions[i][j].z = scattered.z + (target.z - scattered.z) * ease;
                    }
                }
            }

            this.updateLineGeometry(i);

            // Color: white → gold on break, hold gold in drift, gold → white on reassemble
            let colorMix = 0;
            if (p < breakEnd) {
                colorMix = (p / breakEnd) * 0.7;
            } else if (p < driftEnd) {
                colorMix = 0.7;
            } else {
                const t = (p - driftEnd) / (1 - driftEnd);
                colorMix = 0.7 * (1 - t);
            }
            this.lines[i].material.color.copy(this.config.baseColor).lerp(this.config.accentColor, colorMix);

            // Opacity
            if (i < this.swapMaxActive) {
                // Determine if this line existed in the old artwork
                const wasOld = i < this.swapOldPathCount;
                const isNew = i < this.swapNewPathCount;

                if (p < breakEnd) {
                    const t = p / breakEnd;
                    if (wasOld) {
                        // Existing lines: hold at 0.8, gently shift to 0.7
                        this.lines[i].material.opacity = 0.8 - t * 0.1;
                    } else {
                        // New lines: fade in from 0 to 0.7 during break
                        this.lines[i].material.opacity = t * 0.7;
                    }
                } else if (p < driftEnd) {
                    this.lines[i].material.opacity = 0.7;
                } else {
                    const rp = (p - driftEnd) / (1 - driftEnd);
                    // Lines that won't exist in the new artwork: fade out
                    if (!isNew) {
                        const fadeT = Math.max(0, (rp - 0.4) / 0.6);
                        this.lines[i].material.opacity = 0.7 * (1 - fadeT);
                    } else {
                        this.lines[i].material.opacity = 0.7 + rp * 0.1;
                    }
                }
            } else {
                this.lines[i].material.opacity = 0;
            }
        }
    }

    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    updateLineGeometry(i) {
        const positions = this.lines[i].geometry.attributes.position.array;
        for (let j = 0; j < this.maxPointsPerLine; j++) {
            positions[j * 3] = this.currentPositions[i][j].x;
            positions[j * 3 + 1] = this.currentPositions[i][j].y;
            positions[j * 3 + 2] = this.currentPositions[i][j].z;
        }
        this.lines[i].geometry.attributes.position.needsUpdate = true;
    }

    // ---- Energy lines ----

    createEnergyLines() {
        for (let i = 0; i < this.config.energyLineCount; i++) {
            const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: 0xffd700, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending
            });
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
            this.energyLines.push({
                line, geometry, material,
                targetOpacity: 0, currentOpacity: 0,
                angle: 0, active: false
            });
        }
    }

    updateEnergyLines() {
        const maxDist = Math.sqrt(this.width * this.width + this.height * this.height) / 2;
        for (let i = 0; i < this.energyLines.length; i++) {
            const el = this.energyLines[i];
            if (this.isInteracting && el.active && this.autoRevealComplete) {
                el.targetOpacity = this.config.energyLineOpacity;
                const positions = el.geometry.attributes.position.array;
                positions[0] = this.mouseWorld.x;
                positions[1] = this.mouseWorld.y;
                positions[2] = 5;
                positions[3] = this.mouseWorld.x + Math.cos(el.angle) * maxDist;
                positions[4] = this.mouseWorld.y + Math.sin(el.angle) * maxDist;
                positions[5] = 5;
                el.geometry.attributes.position.needsUpdate = true;
            } else {
                el.targetOpacity = 0;
            }
            el.currentOpacity += (el.targetOpacity - el.currentOpacity) * 0.1;
            el.material.opacity = el.currentOpacity;
        }
    }

    activateEnergyLines() {
        const spread = Math.PI * 2 / this.config.energyLineCount;
        for (let i = 0; i < this.config.energyLineCount; i++) {
            const base = (i / this.config.energyLineCount) * Math.PI * 2;
            this.energyLines[i].angle = base + (Math.random() - 0.5) * spread * 0.6;
            this.energyLines[i].active = true;
        }
    }

    deactivateEnergyLines() {
        this.energyLines.forEach(el => el.active = false);
    }

    // ---- Events ----

    setupEventListeners() {
        window.addEventListener('mousemove', (e) => this.onPointerMove(e.clientX, e.clientY));
        window.addEventListener('mouseenter', () => {
            this.isInteracting = true;
            this.activateEnergyLines();
        });
        window.addEventListener('mouseleave', () => {
            this.isInteracting = false;
            this.mouseWorld.set(9999, 9999, 0);
            this.deactivateEnergyLines();
        });

        window.addEventListener('touchstart', (e) => {
            this.isInteracting = true;
            this.activateEnergyLines();
            if (e.touches.length > 0) this.onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) this.onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        window.addEventListener('touchend', () => {
            this.isInteracting = false;
            this.mouseWorld.set(9999, 9999, 0);
            this.deactivateEnergyLines();
        });

        // Click to swap (only after auto-reveal is complete)
        this.renderer.domElement.addEventListener('click', () => {
            if (this.autoRevealComplete) this.swapArtwork();
        });

        window.addEventListener('resize', () => this.onResize());
    }

    onPointerMove(clientX, clientY) {
        this.mouse.x = (clientX / this.width) * 2 - 1;
        this.mouse.y = -(clientY / this.height) * 2 + 1;
        this.mouseWorld.x = this.mouse.x * (this.width / 2);
        this.mouseWorld.y = this.mouse.y * (this.height / 2);
        this.mouseWorld.z = 0;
        this.isInteracting = true;
    }

    onResize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);

        // Recalculate artwork scales for new viewport
        this.recalculateScales();
    }

    // ---- Physics ----

    updateLines() {
        if (!this.autoRevealComplete || this.isSwapping) return;

        const repelRadiusSq = this.config.repelRadius * this.config.repelRadius;
        const pulseOffset = this.config.pulseEnabled
            ? Math.sin(this.time * this.config.pulseSpeed) * this.config.pulseAmount
            : 0;

        for (let i = 0; i < this.maxLineCount; i++) {
            if (!this.lines[i].visible) {
                this.lines[i].material.opacity = 0;
                continue;
            }

            const activeCount = this.lines[i].activePointCount;
            let totalDisplacement = 0;

            for (let j = 0; j < this.maxPointsPerLine; j++) {
                const current = this.currentPositions[i][j];
                const original = this.originalPositions[i][j];
                const velocity = this.velocities[i][j];

                const pulseX = original.x * pulseOffset;
                const pulseY = original.y * pulseOffset;

                const dx = current.x - this.mouseWorld.x;
                const dy = current.y - this.mouseWorld.y;
                const distSq = dx * dx + dy * dy;

                if (this.isInteracting && distSq < repelRadiusSq && distSq > 0) {
                    const dist = Math.sqrt(distSq);
                    const force = (1 - dist / this.config.repelRadius) * this.config.repelStrength;
                    velocity.x += (dx / dist) * force;
                    velocity.y += (dy / dist) * force;
                }

                current.x += velocity.x * 0.1;
                current.y += velocity.y * 0.1;
                velocity.x *= 0.9;
                velocity.y *= 0.9;

                const targetX = original.x + pulseX;
                const targetY = original.y + pulseY;
                current.x += (targetX - current.x) * this.config.returnSpeed;
                current.y += (targetY - current.y) * this.config.returnSpeed;
                current.z += (0 - current.z) * this.config.returnSpeed;

                if (j < activeCount) {
                    totalDisplacement += Math.sqrt(
                        (current.x - original.x) ** 2 + (current.y - original.y) ** 2
                    );
                }
            }

            this.updateLineGeometry(i);

            const avgDisp = activeCount > 0 ? totalDisplacement / activeCount : 0;
            const colorMix = Math.min(avgDisp / 20, 1);
            this.lines[i].material.color.copy(this.config.baseColor).lerp(this.config.accentColor, colorMix);
            this.lines[i].material.opacity = this.lines[i].baseOpacity + colorMix * 0.2;
        }
    }

    // ---- Main loop ----

    animate() {
        requestAnimationFrame(() => this.animate());

        const dt = 0.016;
        this.time += dt;

        // Auto-reveal (only until complete)
        if (!this.autoRevealComplete) {
            this.updateAutoReveal(dt);
        }

        // Swap morph
        this.updateSwap(dt);

        // Physics (only after reveal, when not swapping)
        this.updateLines();

        // Energy lines
        this.updateEnergyLines();

        this.renderer.render(this.scene, this.camera);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window._art = new AballeRevealArt();
});
