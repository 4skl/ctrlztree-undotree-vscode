(function () {
    try {
        const vscode = acquireVsCodeApi();
        let network = null;
        let nodes = new vis.DataSet([]);
        let edges = new vis.DataSet([]);
        let currentHeadNodeId = null;
        let currentSelectedNodeId = null;
        const container = document.getElementById('tree-visualization');
        const documentTitle = document.getElementById('document-title');
        const statusBar = document.getElementById('status-bar');
        const searchInput = document.getElementById('search-input');
        const fitButton = document.getElementById('fit-button');
        const reloadBtn = document.getElementById('reload-btn');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'requestTreeReload' });
            });
        }
        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'requestTreeReset' });
            });
        }
        const diffButton = document.getElementById('diff-button');
        const options = {
            layout: {
                hierarchical: {
                    direction: 'UD',
                    sortMethod: 'directed',
                    levelSeparation: 110,
                    nodeSpacing: 180,
                    treeSpacing: 220
                }
            },
            nodes: {
                shape: 'box',
                margin: 12,
                borderWidth: 1,
                borderWidthSelected: 3,
                widthConstraint: { minimum: 96, maximum: 220 },
                font: { size: 14, multi: 'html', color: 'transparent' }
            },
            edges: {
                arrows: { to: { enabled: true, scaleFactor: 0.55 } },
                color: { color: getCssVar('--vscode-descriptionForeground', '#777777'), opacity: 0.55 },
                smooth: { enabled: true, type: 'cubicBezier', roundness: 0.45 },
                width: 1
            },
            interaction: {
                hover: true,
                navigationButtons: true,
                keyboard: true,
                zoomView: true,
                dragView: true
            },
            physics: false
        };
        network = new vis.Network(container, { nodes, edges }, options);

        const nodeLabelLayer = document.createElement('div');
        nodeLabelLayer.className = 'node-html-label-layer';
        container.appendChild(nodeLabelLayer);
        const nodeLabelElements = new Map();

        try {
            if (diffButton) {
                diffButton.style.position = 'absolute';
                diffButton.style.display = 'none';
                diffButton.onclick = () => {
                    if (currentSelectedNodeId) {
                        vscode.postMessage({ command: 'openDiff', shortHash: currentSelectedNodeId });
                    }
                };
            }
        } catch (e) {
            // ignore errors while re-parenting button
        }

        // Helper to read CSS variables (fallback to provided default)
        function getCssVar(varName, fallback) {
            try {
                const val = getComputedStyle(document.documentElement).getPropertyValue(varName);
                return (val && val.trim()) || fallback;
            } catch (e) {
                return fallback;
            }
        }

        // Helper to determine whether the webview is active/focused and visible
        function isWebviewActive() {
            try {
                return document.hasFocus() && document.visibilityState === 'visible';
            } catch (e) {
                return false;
            }
        }

        // Determine default and active colors based on theme CSS variables
        const defaultNodeColors = {
            background: getCssVar('--vscode-background', '#1e1e1e'),
            border: getCssVar('--vscode-border', '#2d2d30')
        };

        const activeNodeColors = {
            background: getCssVar('--vscode-current', '#094771'),
            border: getCssVar('--vscode-accent', '#007acc')
        };

        function escapeHtml(value) {
            return String(value).replace(/[&<>"]/g, character => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;'
            })[character]);
        }

        function appendSafeHtml(parent, html) {
            const allowedTags = new Set([
                'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'code', 'pre',
                'br', 'hr', 'sub', 'sup', 'mark', 'small', 'span', 'div', 'p',
                'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
            ]);
            const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template']);
            const allowedStyles = ['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'white-space', 'opacity'];
            const template = document.createElement('template');
            template.innerHTML = String(html);

            function appendChildren(source, target) {
                for (const child of Array.from(source.childNodes)) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        target.appendChild(document.createTextNode(child.nodeValue || ''));
                        continue;
                    }
                    if (child.nodeType !== Node.ELEMENT_NODE) {
                        continue;
                    }

                    const tagName = child.tagName.toLowerCase();
                    if (blockedTags.has(tagName)) {
                        continue;
                    }
                    if (!allowedTags.has(tagName)) {
                        appendChildren(child, target);
                        continue;
                    }

                    const safeElement = document.createElement(tagName);
                    for (const property of allowedStyles) {
                        const value = child.style.getPropertyValue(property);
                        if (value && value.length <= 80 && !/(url|expression|javascript|@import)/i.test(value)) {
                            safeElement.style.setProperty(property, value);
                        }
                    }
                    appendChildren(child, safeElement);
                    target.appendChild(safeElement);
                }
            }

            appendChildren(template.content, parent);
        }

        function createNodeHtmlLabel(node) {
            const label = document.createElement('div');
            label.className = 'node-html-label';
            if (node.category) {
                label.classList.add(`node-${node.category}`);
            }
            if (node.id === currentHeadNodeId) {
                label.classList.add('node-html-label-head');
            }
            if (node.id === currentSelectedNodeId) {
                label.classList.add('node-html-label-selected');
            }

            const title = document.createElement('div');
            title.className = 'node-html-label-title';
            appendSafeHtml(title, node.htmlLabel || node.label || node.firstLine || node.id || '');
            label.appendChild(title);

            if (node.caption) {
                const caption = document.createElement('div');
                caption.className = 'node-html-label-caption';
                appendSafeHtml(caption, node.caption);
                label.appendChild(caption);
            }
            return label;
        }

        function replaceNodeHtmlLabels(treeNodes) {
            nodeLabelElements.clear();
            nodeLabelLayer.replaceChildren();
            for (const node of treeNodes) {
                const label = createNodeHtmlLabel(node);
                nodeLabelElements.set(node.id, label);
                nodeLabelLayer.appendChild(label);
            }
            updateNodeHtmlLabelPositions();
        }

        function updateNodeHtmlLabelPositions() {
            if (!network || nodeLabelElements.size === 0) {
                return;
            }
            const positions = network.getPositions();
            const scale = network.getScale();
            for (const [id, label] of nodeLabelElements) {
                const position = positions[id];
                const node = nodes.get(id);
                if (!position || !node || node.hidden) {
                    label.style.display = 'none';
                    continue;
                }
                const domPosition = network.canvasToDOM(position);
                label.style.left = `${domPosition.x}px`;
                label.style.top = `${domPosition.y}px`;
                label.style.transform = `translate(-50%, -50%) scale(${scale})`;
                label.style.display = 'block';
            }
        }

        function updateSelectionDisplay() {
            for (const [id, label] of nodeLabelElements) {
                label.classList.toggle('node-html-label-selected', id === currentSelectedNodeId);
            }

            if (statusBar) {
                const nodeCount = nodes.get().length;
                const selectedText = currentSelectedNodeId ? ` · Selected: ${currentSelectedNodeId}` : '';
                statusBar.textContent = `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'} · Head: ${currentHeadNodeId || 'none'}${selectedText}`;
            }

            updateDiffButtonPosition(currentSelectedNodeId);
        }

        function applySearchFilter(query) {
            const normalized = String(query || '').trim().toLowerCase();
            let matchCount = 0;

            for (const [id, label] of nodeLabelElements) {
                const node = nodes.get(id);
                if (!node) {
                    continue;
                }
                const searchable = [
                    id,
                    node.shortHash,
                    node.fullHash,
                    node.firstLine,
                    node.previewLabel,
                    node.caption,
                    node.title
                ].filter(Boolean).join(' ').toLowerCase();
                const matches = normalized.length > 0 && searchable.includes(normalized);

                label.classList.toggle('node-html-label-match', matches);
                label.classList.toggle('node-html-label-muted', normalized.length > 0 && !matches);
                if (matches) {
                    matchCount++;
                }
            }

            if (statusBar) {
                const nodeCount = nodes.get().length;
                statusBar.textContent = normalized
                    ? `${matchCount} ${matchCount === 1 ? 'node' : 'nodes'} match "${query.trim()}"`
                    : `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'} · Head: ${currentHeadNodeId || 'none'}${currentSelectedNodeId ? ` · Selected: ${currentSelectedNodeId}` : ''}`;
            }
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                applySearchFilter(searchInput.value);
            });
            searchInput.addEventListener('keydown', event => {
                if (event.key !== 'Enter') {
                    return;
                }
                const query = searchInput.value.trim().toLowerCase();
                if (!query) {
                    return;
                }
                const match = nodes.get().find(node => {
                    const searchable = [
                        node.id,
                        node.shortHash,
                        node.fullHash,
                        node.firstLine,
                        node.previewLabel,
                        node.caption,
                        node.title
                    ].filter(Boolean).join(' ').toLowerCase();
                    return searchable.includes(query);
                });
                if (match) {
                    currentSelectedNodeId = match.id;
                    network.selectNodes([match.id]);
                    network.focus(match.id, { scale: 1.15, animation: { duration: 260, easingFunction: 'easeInOutQuad' } });
                    vscode.postMessage({ command: 'navigateToNode', shortHash: match.id });
                }
            });
        }

        if (fitButton) {
            fitButton.addEventListener('click', () => {
                network.fit({ animation: { duration: 260, easingFunction: 'easeInOutQuad' } });
            });
        }

        // Keep a small cache of original node styles so we can revert after hover
        const originalNodeStyles = new Map();

        // Prevent vis.js from changing node colors on hover/highlight by aligning
        // the hover/highlight color with the default node colors. Then handle a
        // subtle "scale" effect manually via font size + border width changes.
        try {
            if (network && typeof network.setOptions === 'function') {
                network.setOptions({
                    nodes: {
                        color: {
                            hover: { background: defaultNodeColors.background, border: defaultNodeColors.border },
                            highlight: { background: defaultNodeColors.background, border: defaultNodeColors.border }
                        },
                        font: { size: 14, multi: 'html', color: 'transparent' }
                    }
                });
            }
        } catch (e) {
            // ignore if setOptions fails for any reason
        }

        function applyHeadStyle(headId) {
            try {
                const all = nodes.get();
                const updates = all.map(n => {
                    if (!n) return null;
                    if (n.id === headId) {
                        return {
                            id: n.id,
                            color: { background: activeNodeColors.background, border: activeNodeColors.border },
                            borderWidth: 3,
                            font: { ...(n.font || {}), color: 'transparent', size: (n.font && n.font.size) || 14, face: (n.font && n.font.face) || undefined, vadjust: 0, multi: 'html' }
                        };
                    }
                    return {
                        id: n.id,
                        color: { background: defaultNodeColors.background, border: defaultNodeColors.border },
                        borderWidth: 1,
                        font: { ...(n.font || {}), color: 'transparent', size: (n.font && n.font.size) || 14, face: (n.font && n.font.face) || undefined, vadjust: 0, multi: 'html' }
                    };
                }).filter(Boolean);
                if (updates.length > 0) {
                    nodes.update(updates);
                }
            } catch (e) {
                // ignore styling errors
            }
        }

        function focusHeadNode(headId) {
            try {
                if (!network || typeof network.selectNodes !== 'function') {
                    return;
                }

                if (!headId) {
                    currentSelectedNodeId = null;
                    if (typeof network.unselectAll === 'function') {
                        network.unselectAll();
                    }
                    if (diffButton) {
                        diffButton.style.display = 'none';
                    }
                    return;
                }

                currentSelectedNodeId = headId;
                network.selectNodes([headId]);
                updateSelectionDisplay();
            } catch (e) {
                // ignore focus errors
            }
        }

        // Hover handlers: create a subtle scale effect by increasing font size
        // and border width slightly on hover, then revert on blur.
        try {
            network.on('hoverNode', params => {
                try {
                    const id = params.node;
                    if (!id) return;
                    const node = nodes.get(id);
                    if (!node) return;

                    if (!originalNodeStyles.has(id)) {
                        originalNodeStyles.set(id, {
                            fontSize: (node.font && node.font.size) || 14,
                            borderWidth: node.borderWidth || 1
                        });
                    }

                    const orig = originalNodeStyles.get(id);
                    const increasedSize = Math.max(12, Math.round(orig.fontSize * 1.08));
                    const increasedBorder = Math.max(1, orig.borderWidth + 1);

                    nodes.update({ id, font: { ...(node.font || {}), size: increasedSize }, borderWidth: increasedBorder });
                    // Do NOT change selection or show the diff button on hover.
                    // Hover only provides the subtle scale feedback.
                } catch (e) {
                    // ignore
                }
            });

            network.on('blurNode', params => {
                try {
                    const id = params.node;
                    if (!id) return;
                    const orig = originalNodeStyles.get(id);
                    if (!orig) return;
                    const currentNode = nodes.get(id) || {};
                    nodes.update({ id, font: { ...(currentNode.font || {}), size: orig.fontSize }, borderWidth: orig.borderWidth });
                    originalNodeStyles.delete(id);
                    // Reposition anchored button if there is an explicitly selected node
                    try {
                        if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
                    } catch (e) { /* ignore */ }
                } catch (e) {
                    // ignore
                }
            });
        } catch (e) {
            // ignore if network events are unavailable
        }

        vscode.postMessage({ command: 'webviewReady' });
        function updateDiffButtonPosition(selectedNodeId) {
            try {
                if (!diffButton || !network) return;
                if (!selectedNodeId) {
                    try { diffButton.style.display = 'none'; } catch (e) {}
                    return;
                }
                const node = nodes.get(selectedNodeId);
                if (!node || !node.hasParent) {
                    diffButton.style.display = 'none';
                    return;
                }
                const position = network.getPositions([selectedNodeId])[selectedNodeId];
                if (!position) return;
                const bounds = network.getBoundingBox(selectedNodeId);
                const domPosition = network.canvasToDOM({ x: position.x, y: bounds.bottom });
                const containerRect = container.getBoundingClientRect();
                const left = domPosition.x - diffButton.offsetWidth / 2;
                const top = domPosition.y + 8;
                const clampedLeft = Math.max(8, Math.min(left, containerRect.width - diffButton.offsetWidth - 8));
                const clampedTop = Math.max(8, Math.min(top, containerRect.height - diffButton.offsetHeight - 8));
                diffButton.style.left = `${clampedLeft}px`;
                diffButton.style.top = `${clampedTop}px`;

                diffButton.style.display = 'block';
            } catch (e) {
                // ignore positioning errors
            }
        }

        network.on('selectNode', params => {
            if (params.nodes.length === 0) {
                return;
            }
            const selectedNodeId = params.nodes[0];
            const node = nodes.get(selectedNodeId);
            if (!node) {
                return;
            }
            currentSelectedNodeId = selectedNodeId;
            updateSelectionDisplay();
        });
        
        // When the network is redrawn (panning/zooming/animation), keep the
        // diff button anchored to the currently selected node.
        network.on('afterDrawing', () => {
            updateNodeHtmlLabelPositions();
            if (currentSelectedNodeId) {
                updateDiffButtonPosition(currentSelectedNodeId);
            }
        });

        // Reposition while zooming or after drag (pan) ends.
        network.on('zoom', () => {
            updateNodeHtmlLabelPositions();
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        });
        network.on('dragEnd', () => {
            updateNodeHtmlLabelPositions();
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        });

        // Also update on window resize/scroll so the button stays aligned
        window.addEventListener('resize', () => {
            updateNodeHtmlLabelPositions();
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        });
        window.addEventListener('scroll', () => {
            updateNodeHtmlLabelPositions();
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        }, { passive: true });
        network.on('deselectNode', () => {
            currentSelectedNodeId = null;
            updateSelectionDisplay();
        });
        network.on('click', params => {
            if (params.nodes.length === 0) {
                return;
            }
            const selectedNodeId = params.nodes[0];
            const node = nodes.get(selectedNodeId);
            if (node && node.hasParent) {
                vscode.postMessage({ command: 'openDiff', shortHash: selectedNodeId });
            }
        });
        network.on('doubleClick', params => {
            if (params.nodes.length > 0) {
                vscode.postMessage({ command: 'navigateToNode', shortHash: params.nodes[0] });
            }
        });
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateTree':
                    nodes.clear();
                    edges.clear();
                    const processedNodes = message.nodes.map(node => {
                        const title = escapeHtml(node.label || node.shortHash || node.id || '');
                        const caption = node.caption
                            ? node.caption.split('\n').map(escapeHtml).join('<br>')
                            : '';
                        const label = caption
                            ? `<b>${title}</b><br><i>${caption}</i>`
                            : title;
                        return {
                            ...node,
                            label,
                            font: { ...(node.font || {}), multi: 'html', color: 'transparent' }
                        };
                    });
                    nodes.add(processedNodes);
                    // Clear any cached hover styles since node identities/styles changed
                    try { originalNodeStyles.clear(); } catch (e) { /* ignore */ }
                    edges.add(message.edges);
                    currentHeadNodeId = message.headShortHash;
                    if (documentTitle) {
                        documentTitle.textContent = message.documentName || 'History';
                        documentTitle.title = message.documentName || 'History';
                    }
                    if (statusBar) {
                        const nodeCount = message.nodes.length;
                        statusBar.textContent = `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'} · Current: ${message.headShortHash || 'none'}`;
                    }
                    replaceNodeHtmlLabels(message.nodes);
                    if (searchInput && searchInput.value) {
                        applySearchFilter(searchInput.value);
                    }
                    // Apply visual style to the current head node (and reset others)
                    try {
                        if (currentHeadNodeId) {
                            applyHeadStyle(currentHeadNodeId);
                            focusHeadNode(currentHeadNodeId);
                        } else {
                            applyHeadStyle(null);
                            focusHeadNode(null);
                        }
                        updateSelectionDisplay();
                    } catch (e) {
                        // ignore styling errors
                    }
                    break;
                case 'updateTheme':
                    // Theme update handled through CSS variables
                    break;
            }
        });
    } catch (error) {
        vscode.postMessage({ command: 'webviewError', error: { message: error.message, stack: error.stack } });
    }
})();
