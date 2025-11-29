(function () {
    try {
        const vscode = acquireVsCodeApi();
        let network = null;
        let nodes = new vis.DataSet([]);
        let edges = new vis.DataSet([]);
        let currentHeadNodeId = null;
        let currentSelectedNodeId = null;
        const container = document.getElementById('tree-visualization');
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
                    sortMethod: 'directed'
                }
            },
            nodes: {
                shape: 'box',
                margin: 10,
                widthConstraint: { maximum: 220 },
                font: { size: 14 }
            },
            edges: {
                arrows: 'to'
            },
            interaction: {
                hover: true,
                navigationButtons: true,
                keyboard: true
            }
        };
        network = new vis.Network(container, { nodes, edges }, options);

        // Place the diff button on the document body so positioning uses
        // `canvasToDOM` coordinates directly (document-relative). This is
        // more robust across canvas transforms and ensures the button
        // visually aligns with nodes.
        try {
            if (diffButton) {
                diffButton.style.position = 'absolute';
                document.body.appendChild(diffButton);
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

        // Determine default and active colors based on theme CSS variables
        const defaultNodeColors = {
            background: getCssVar('--vscode-background', '#1e1e1e'),
            border: getCssVar('--vscode-border', '#2d2d30'),
            font: getCssVar('--vscode-foreground', '#d4d4d4')
        };

        const activeNodeColors = {
            background: getCssVar('--vscode-current', '#094771'),
            border: getCssVar('--vscode-accent', '#007acc'),
            font: '#ffffff'
        };

        // Keep a small cache of original node styles so we can revert after hover
        const originalNodeStyles = new Map();
        // Remember the previously selected node while hovering so we can restore it
        let hoverPreviousSelected = null;

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
                        }
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
                            font: { color: activeNodeColors.font, size: (n.font && n.font.size) || 14, face: (n.font && n.font.face) || undefined, vadjust: 0 }
                        };
                    }
                    return {
                        id: n.id,
                        color: { background: defaultNodeColors.background, border: defaultNodeColors.border },
                        borderWidth: 1,
                        font: { color: defaultNodeColors.font, size: (n.font && n.font.size) || 14, face: (n.font && n.font.face) || undefined, vadjust: 0 }
                    };
                }).filter(Boolean);
                if (updates.length > 0) {
                    nodes.update(updates);
                }
            } catch (e) {
                // ignore styling errors
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
                    // While hovering, temporarily treat this node as the selected node
                    hoverPreviousSelected = currentSelectedNodeId;
                    currentSelectedNodeId = id;
                    // reposition diff button to stay aligned and keep it anchored during redraws
                    updateDiffButtonPosition(currentSelectedNodeId);
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
                    // Restore previously selected node (if any) so anchoring continues
                    currentSelectedNodeId = hoverPreviousSelected;
                    hoverPreviousSelected = null;
                    if (currentSelectedNodeId) {
                        updateDiffButtonPosition(currentSelectedNodeId);
                    } else {
                        // hide button when nothing should be anchored
                        try { diffButton.style.display = 'none'; } catch (e) {}
                    }
                } catch (e) {
                    // ignore
                }
            });
        } catch (e) {
            // ignore if network events are unavailable
        }

        // If the extension injected initial data into the template, use it to populate the view immediately
        if (window.initialData) {
            try {
                if (Array.isArray(window.initialData.nodes) && window.initialData.nodes.length > 0) {
                    nodes.clear();
                    nodes.add(window.initialData.nodes);
                }
                if (Array.isArray(window.initialData.edges) && window.initialData.edges.length > 0) {
                    edges.clear();
                    edges.add(window.initialData.edges);
                }
                currentHeadNodeId = window.initialData.headShortHash || null;
                if (currentHeadNodeId) {
                    // Apply visual style to current head node
                    applyHeadStyle(currentHeadNodeId);
                }
            } catch (err) {
                // ignore malformed initial data
            }
        }
        function updateDiffButtonPosition(selectedNodeId) {
            try {
                if (!diffButton || !network || !selectedNodeId) return;
                const node = nodes.get(selectedNodeId);
                if (!node || !node.hasParent) {
                    diffButton.style.display = 'none';
                    return;
                }
                const position = network.getPositions([selectedNodeId])[selectedNodeId];
                if (!position) return;
                const domPosition = network.canvasToDOM({ x: position.x, y: position.y });
                const scale = (typeof network.getScale === 'function') ? network.getScale() : 1;
                const left = domPosition.x - diffButton.offsetWidth / 2 + window.scrollX;
                // Adjust the vertical offset by the current zoom scale so the
                // button remains visually positioned under the node when zooming.
                const verticalOffset = 30 * scale;
                const top = domPosition.y + verticalOffset + window.scrollY;
                const clampedLeft = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - diffButton.offsetWidth - 8));
                const clampedTop = Math.max(8 + window.scrollY, Math.min(top, window.scrollY + document.documentElement.clientHeight - diffButton.offsetHeight - 8));
                diffButton.style.left = `${clampedLeft}px`;
                diffButton.style.top = `${clampedTop}px`;

                // Post debug info for diagnostics (non-blocking)
                try {
                    vscode.postMessage({
                        command: 'dbgCoords',
                        data: {
                            selectedNodeId,
                            position: { x: position.x, y: position.y },
                            domPosition: { x: domPosition.x, y: domPosition.y },
                            left,
                            top,
                            clampedLeft,
                            clampedTop
                        }
                    });
                } catch (e) {
                    // ignore
                }

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
            updateDiffButtonPosition(selectedNodeId);
            diffButton.onclick = () => {
                vscode.postMessage({ command: 'openDiff', shortHash: selectedNodeId });
            };
        });
        
        // When the network is redrawn (panning/zooming/animation), keep the
        // diff button anchored to the currently selected node.
        network.on('afterDrawing', () => {
            if (currentSelectedNodeId) {
                updateDiffButtonPosition(currentSelectedNodeId);
            }
        });

        // Reposition while zooming or after drag (pan) ends.
        network.on('zoom', () => {
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        });
        network.on('dragEnd', () => {
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        });

        // Also update on window resize/scroll so the button stays aligned
        window.addEventListener('resize', () => {
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        });
        window.addEventListener('scroll', () => {
            if (currentSelectedNodeId) updateDiffButtonPosition(currentSelectedNodeId);
        }, { passive: true });
        network.on('deselectNode', () => {
            diffButton.style.display = 'none';
        });
        network.on('click', params => {
            if (params.nodes.length === 0) {
                return;
            }
            vscode.postMessage({ command: 'navigateToNode', shortHash: params.nodes[0] });
        });
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateTree':
                    nodes.clear();
                    edges.clear();
                    nodes.add(message.nodes);
                    // Clear any cached hover styles since node identities/styles changed
                    try { originalNodeStyles.clear(); } catch (e) { /* ignore */ }
                    edges.add(message.edges);
                    currentHeadNodeId = message.headShortHash;
                    // Apply visual style to the current head node (and reset others)
                    try {
                        if (currentHeadNodeId) {
                            applyHeadStyle(currentHeadNodeId);
                        } else {
                            applyHeadStyle(null);
                        }
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
