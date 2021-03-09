import * as vscode from 'vscode';

import { GoToClunctionProvider } from './goToClunction';

export function activate(context: vscode.ExtensionContext) {
    const goToClunctionProvider = new GoToClunctionProvider();
    goToClunctionProvider.initialise(context);
}
