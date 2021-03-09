import {
    TextDocument,
    TextEditor,
    TextLine,
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

/* Returns true if a symbol should be kept in the symbol list, or false if it should be discarded

This is the place to do any kind of ad hoc, document/language specific filtering of symbols
*/
function keep_symbol(symbol: DocumentSymbol, document: TextDocument): boolean {
    let languageId = window.activeTextEditor?.document.languageId;
    
    if (languageId == "python") {
        let lineNo = symbol.range.start.line;
        let text = document.lineAt(lineNo).text;
        // discard symbols from import statements, they're not useful to see in the menu
        if (text.startsWith("from ") || text.startsWith("import ")) {
            return false
        }
    }
    return true;
}

// find the closest symbol immediately preceding lineNoQuery. This is taken to be the symbol we are currently "in".
function findClosestSymbol(lineNoQuery: number, symbols: SymbolEntry[]): SymbolEntry {
    const sorted = [...symbols].sort();
    let closest = symbols[0];
    for (const sym of sorted) {
        if (!sym.range) {continue;}
        let symLineNo = sym.range.start.line;
        if (symLineNo > lineNoQuery) {
            return closest;
        }
        closest = sym;
    }
    return closest;
}

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
                markdownString = new MarkdownString('$(symbol-method)      ' + symbol.name);
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

    // show a quick pick menu with symbol entries
    // inspiration from https://github.com/microsoft/vscode-extension-samples/blob/463571f99a815d66e08264b516203fe6a1349d1a/quickinput-sample/src/multiStepInput.ts#L204
    private async showMenu(entries: SymbolEntry[], 
            activeTextEditor: TextEditor, currLine: TextLine): Promise<SymbolEntry> {
        
        // find the closest symbol to the current cursor line in the document
        const currLineNo = currLine.lineNumber;
        const closestSymbol = findClosestSymbol(currLineNo, entries);
        
        return await new Promise((resolve, reject) => {
            const input = window.createQuickPick<SymbolEntry>();
            // input.title = 'title';
            // steps is only used when multiple menus are presented in subsequent steps
            // input.step = 1;
            // input.totalSteps = 1;
            input.placeholder = "go to a class or function";
            input.items = entries;
            // set the initial choice in the menu as the closest symbol
            if (closestSymbol) {
                input.activeItems = [closestSymbol];
            }
            // when the user navigates to a new choice in the menu
            input.onDidChangeActive(items => {
                // there will only be one active item
                let activeItem = items[0];
                // if (!activeItem.range) { return; }
                // not really sure this is the right way to handle it, might need to revisit this
                if (!activeItem.range) { reject(new Error("Whoops!")); return;}

                // Preview the selected item by highlighting the scope and scrolling to it
                activeTextEditor.setDecorations(this.decorationType, [activeItem.range]);
                activeTextEditor.revealRange(activeItem.range, TextEditorRevealType.Default);
            });
            // when the user hits enter
            input.onDidAccept(() => {
                let selectedItem = input.selectedItems[0];
                input.dispose();
                resolve(selectedItem);
            });
            input.show();
        })
    }

    private async showQuickView() {
        const activeTextEditor = window.activeTextEditor;
        if (!activeTextEditor) { return; }
        
        // find current line in the document, so that we can activate the menu at the closest symbol
        // todo: what happens if there are multiple selection regions?
        let curPos = activeTextEditor.selection.active;
        const currLine = activeTextEditor.document.lineAt(curPos);

        const symbolEntries = this.getSymbols(activeTextEditor.document)
            .then(syms => {
                if (syms.length === 0) {
                    return [SymbolEntry.fromLabel('No symbols found')];
                }

                const newSymbols: SymbolEntry[] = [];

                const addSymbols = (symbols: DocumentSymbol[], parentSymbol?: DocumentSymbol) => {
                    let symbols_filt = symbols.filter(symbol =>
                        symbol.kind === SymbolKind.Method ||
                        symbol.kind === SymbolKind.Function ||
                        symbol.kind === SymbolKind.Class ||
                        symbol.kind === SymbolKind.Constructor); 
                    for (const sym of symbols_filt) {
                        if (keep_symbol(sym, activeTextEditor.document)) {
                            newSymbols.push(SymbolEntry.fromDocumentSymbol(sym, parentSymbol));
                        }
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

        
        const pickedItem = await symbolEntries.then(entries => this.showMenu(entries, activeTextEditor, currLine));

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
