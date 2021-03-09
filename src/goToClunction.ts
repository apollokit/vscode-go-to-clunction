import {
    TextDocument,
    ExtensionContext,
    QuickPickItem,
    commands,
    window,
    SymbolKind,
    TextEditorRevealType,
    TextEditorDecorationType,
    ThemeColor,
    Range,
    Selection,
    DocumentSymbol,
    MarkdownString
} from 'vscode';

class SymbolEntry implements QuickPickItem {
    private constructor() { }

    public static fromDocumentSymbol(symbol: DocumentSymbol, parentSymbol?: DocumentSymbol) {
        // the $(...) is a theme icon, see
        // https://vshaxe.github.io/vscode-extern/vscode/MarkdownString.html#ThemeIcon
        // https://code.visualstudio.com/api/references/icons-in-labels#animation
        let markdownString;
        switch (symbol.kind) {
            case SymbolKind.Class:
                markdownString = new MarkdownString('$(symbol-class) ' + symbol.name);
                break;
            default:
                markdownString = new MarkdownString('$(symbol-method)    ' + symbol.name);
        }

        const entry = new SymbolEntry();
        entry.label = markdownString.value;
        entry.description = parentSymbol ? parentSymbol.name : '';
        entry.range = symbol.range;

        return entry;
    }

    public static fromLabel(label: string) {
        const entry = new SymbolEntry();
        entry.label = label;

        return entry;
    }

    public label!: string;
    public description?: string;
    public detail?: string;
    public picked?: boolean;
    public range?: Range;
}

export class GoToClunctionProvider {
    private decorationType!: TextEditorDecorationType;

    public initialise(context: ExtensionContext) {
        context.subscriptions.push(
            commands.registerCommand('workbench.action.gotoClunction', () => this.showQuickView())
        );

        this.decorationType = window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: new ThemeColor('editor.rangeHighlightBackground')
        });
        context.subscriptions.push(this.decorationType);
    }

    private async getSymbols(document: TextDocument): Promise<DocumentSymbol[]> {
        const result = await commands.executeCommand<DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        return result || [];
    }

    private async showQuickView() {
        const activeTextEditor = window.activeTextEditor;
        if (!activeTextEditor) { return; }

        const symbolEntries = this.getSymbols(activeTextEditor.document)
            .then(syms => {
                if (syms.length === 0) {
                    return [SymbolEntry.fromLabel('No symbols found')];
                }

                const newSymbols: SymbolEntry[] = [];

                const addSymbols = (symbols: DocumentSymbol[], parentSymbol?: DocumentSymbol) => {
                    for (const sym of symbols.filter(symbol =>
                        symbol.kind === SymbolKind.Method ||
                        symbol.kind === SymbolKind.Function ||
                        symbol.kind === SymbolKind.Class ||
                        symbol.kind === SymbolKind.Constructor)) {
                        newSymbols.push(SymbolEntry.fromDocumentSymbol(sym, parentSymbol));
                    }
                };

                // Add any symbols from the top most scope
                addSymbols(syms);

                // Now include any symbols that are children of the top most scope
                for (const sym of syms) {
                    addSymbols(sym.children, sym);
                }
                
                // sort symbols by order of appearance in the document
                newSymbols.sort(function (a, b) { 
                    // these shouldn't be undefined, but have to make the compiler happy
                    if (a.range === undefined || b.range === undefined) {return -1;}
                    return a.range.start.compareTo(b.range.start);
                });

                return newSymbols;
            });

        const currentRange = activeTextEditor.visibleRanges.length > 0
            ? activeTextEditor.visibleRanges[0]
            : new Range(0, 0, 0, 0);

        const pickedItem = await window.showQuickPick(
            symbolEntries, {
            onDidSelectItem: (selectedItem: SymbolEntry) => {
                if (!selectedItem.range) { return; }

                // Preview the selected item by highlighting the scope and scrolling to it
                activeTextEditor.setDecorations(this.decorationType, [selectedItem.range]);
                activeTextEditor.revealRange(selectedItem.range, TextEditorRevealType.Default);
            },
            placeHolder: "class or function",
        });

        // Clear decorations
        activeTextEditor.setDecorations(this.decorationType, []);

        if (pickedItem && pickedItem.range) {
            const range = pickedItem.range;

            // Scroll to the selected function, positioning the cursor at the beginning
            activeTextEditor.revealRange(range, TextEditorRevealType.Default);
            activeTextEditor.selection = new Selection(range.start, range.start);
        } else {
            // Restore the old scroll position
            activeTextEditor.revealRange(currentRange, TextEditorRevealType.Default);
        }
    }
}
