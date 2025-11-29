(function () {
    try {
        const vscode = acquireVsCodeApi();
        let network = null;
        let nodes = new vis.DataSet([]);
        let edges = new vis.DataSet([]);
        let currentHeadNodeId = null;
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
        network.on('selectNode', params => {
            if (params.nodes.length === 0) {
                return;
            }
            const selectedNodeId = params.nodes[0];
            const node = nodes.get(selectedNodeId);
            if (!node) {
                return;
            }
            if (node.hasParent) {
                const position = network.getPositions([selectedNodeId])[selectedNodeId];
                const domPosition = network.canvasToDOM({ x: position.x, y: position.y });
                diffButton.style.left = `${domPosition.x - diffButton.offsetWidth / 2}px`;
                diffButton.style.top = `${domPosition.y + 30}px`;
                diffButton.style.display = 'block';
                diffButton.onclick = () => {
                    vscode.postMessage({ command: 'openDiff', shortHash: selectedNodeId });
                };
            } else {
                diffButton.style.display = 'none';
            }
        });
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
