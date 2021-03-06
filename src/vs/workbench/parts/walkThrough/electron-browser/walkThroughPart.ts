/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./walkThroughPart';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import * as strings from 'vs/base/common/strings';
import URI from 'vs/base/common/uri';
import { TPromise } from 'vs/base/common/winjs.base';
import { DefaultConfig } from 'vs/editor/common/config/defaultConfig';
import { IEditorOptions, IEditorViewState } from 'vs/editor/common/editorCommon';
import { $, Dimension, Builder } from 'vs/base/browser/builder';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { EditorOptions } from 'vs/workbench/common/editor';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { WalkThroughInput } from 'vs/workbench/parts/walkThrough/node/walkThroughInput';
import { IThemeService } from 'vs/workbench/services/themes/common/themeService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { marked } from 'vs/base/common/marked/marked';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IFileService } from 'vs/platform/files/common/files';
import { IModelService } from 'vs/editor/common/services/modelService';
import { CodeEditor } from 'vs/editor/browser/codeEditor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { localize } from 'vs/nls';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { Scope } from 'vs/workbench/common/memento';

const UNBOUND_COMMAND = localize('walkThrough.unboundCommand', "unbound");
const WALK_THROUGH_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'walkThroughEditorViewState';

interface IViewState {
	scrollTop: number;
	scrollLeft: number;
}

interface IWalkThroughEditorViewState extends IEditorViewState {
	viewState: IViewState;
}

interface IWalkThroughEditorViewStates {
	0?: IWalkThroughEditorViewState;
	1?: IWalkThroughEditorViewState;
	2?: IWalkThroughEditorViewState;
}

export class WalkThroughPart extends BaseEditor {

	static ID: string = 'workbench.editor.walkThroughPart';

	private disposables: IDisposable[] = [];
	private contentDisposables: IDisposable[] = [];
	private content: HTMLDivElement;
	private scrollbar: DomScrollableElement;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IThemeService private themeService: IThemeService,
		@IOpenerService private openerService: IOpenerService,
		@IFileService private fileService: IFileService,
		@IModelService protected modelService: IModelService,
		@IKeybindingService private keybindingService: IKeybindingService,
		@IStorageService private storageService: IStorageService,
		@IModeService private modeService: IModeService
	) {
		super(WalkThroughPart.ID, telemetryService);
	}

	createEditor(parent: Builder): void {
		const container = parent.getHTMLElement();

		this.content = document.createElement('div');

		this.scrollbar = new DomScrollableElement(this.content, {
			canUseTranslate3d: false,
			horizontal: ScrollbarVisibility.Auto,
			vertical: ScrollbarVisibility.Auto
		});
		this.disposables.push(this.scrollbar);
		container.appendChild(this.scrollbar.getDomNode());

		this.registerClickHandler();
	}

	private registerClickHandler() {
		this.content.addEventListener('click', event => {
			for (let node = event.target as HTMLElement; node; node = node.parentNode as HTMLElement) {
				if (node instanceof HTMLAnchorElement && node.href) {
					let baseElement = window.document.getElementsByTagName('base')[0] || window.location;
					if (baseElement && node.href.indexOf(baseElement.href) >= 0 && node.hash) {
						let scrollTarget = this.content.querySelector(node.hash);
						if (scrollTarget) {
							const targetTop = scrollTarget.getBoundingClientRect().top;
							const containerTop = this.content.getBoundingClientRect().top;
							this.scrollbar.updateState({ scrollTop: targetTop - containerTop });
						}
					} else {
						const uri = this.addFrom(URI.parse(node.href));
						this.openerService.open(uri);
					}
					event.preventDefault();
					break;
				} else if (node instanceof HTMLButtonElement) {
					const href = node.getAttribute('data-href');
					if (href) {
						const uri = this.addFrom(URI.parse(href));
						this.openerService.open(uri);
					}
					break;
				} else if (node === event.currentTarget) {
					break;
				}
			}
		});
	}

	private addFrom(uri: URI) {
		if (uri.scheme !== 'command') {
			return uri;
		}
		const query = uri.query ? JSON.parse(uri.query) : {};
		query.from = (<WalkThroughInput>this.input).getTelemetryFrom();
		return uri.with({ query: JSON.stringify(query) });
	}

	layout({ width, height }: Dimension): void {
		$(this.content).style({ height: `${height}px`, width: `${width}px` });
		const innerContent = this.content.firstElementChild;
		if (innerContent) {
			const classList = innerContent.classList;
			classList[height <= 690 ? 'add' : 'remove']('max-height-690px');
		}
		this.contentDisposables.forEach(disposable => {
			if (disposable instanceof CodeEditor) {
				disposable.layout();
			}
		});
		this.scrollbar.scanDomNode();
	}

	focus(): void {
		this.content.focus();
	}

	setInput(input: WalkThroughInput, options: EditorOptions): TPromise<void> {
		if (this.input instanceof WalkThroughInput) {
			this.saveTextEditorViewState(this.input.getResource());
		}

		this.contentDisposables = dispose(this.contentDisposables);
		this.content.innerHTML = '';

		return super.setInput(input, options)
			.then(() => {
				return input.resolve(true);
			})
			.then(model => {
				const content = model.main.textEditorModel.getLinesContent().join('\n');
				if (strings.endsWith(input.getResource().path, '.html')) {
					this.content.innerHTML = content;
					this.decorateContent();
					if (input.onReady) {
						input.onReady(this.content.firstElementChild as HTMLElement);
					}
					this.scrollbar.scanDomNode();
					this.loadTextEditorViewState(input.getResource());
					return;
				}

				let i = 0;
				const renderer = new marked.Renderer();
				renderer.code = (code, lang) => {
					const id = `snippet-${model.snippets[i++].textEditorModel.uri.fragment}`;
					return `<div id="${id}" class="walkThroughEditorContainer" ></div>`;
				};
				const innerContent = document.createElement('div');
				innerContent.classList.add('walkThroughContent'); // only for markdown files
				const markdown = this.expandMacros(content);
				innerContent.innerHTML = marked(markdown, { renderer });
				this.style(innerContent);
				this.contentDisposables.push(this.themeService.onDidColorThemeChange(() => this.style(innerContent)));
				this.content.appendChild(innerContent);

				model.snippets.forEach((snippet, i) => {
					const model = snippet.textEditorModel;
					const id = `snippet-${model.uri.fragment}`;
					const div = innerContent.querySelector(`#${id.replace(/\./g, '\\.')}`) as HTMLElement;

					var options: IEditorOptions = {
						scrollBeyondLastLine: false,
						scrollbar: DefaultConfig.editor.scrollbar,
						overviewRulerLanes: 3,
						fixedOverflowWidgets: true,
						lineNumbersMinChars: 1,
						theme: this.themeService.getColorTheme().id,
					};

					const editor = this.instantiationService.createInstance(CodeEditor, div, options);
					editor.setModel(model);
					this.contentDisposables.push(editor);

					const updateHeight = (initial: boolean) => {
						const lineHeight = editor.getConfiguration().lineHeight;
						const height = `${Math.max(model.getLineCount() + 1, 4) * lineHeight}px`;
						if (div.style.height !== height) {
							div.style.height = height;
							editor.layout();
							if (!initial) {
								this.scrollbar.scanDomNode();
							}
						}
					};
					updateHeight(true);
					this.contentDisposables.push(editor.onDidChangeModelContent(() => updateHeight(false)));

					this.contentDisposables.push(this.themeService.onDidColorThemeChange(theme => editor.updateOptions({ theme: theme.id })));

					if (i === 0) {
						editor.focus();
					}
				});
				if (input.onReady) {
					input.onReady(innerContent);
				}
				this.scrollbar.scanDomNode();
				this.loadTextEditorViewState(input.getResource());
			});
	}

	private style(div: HTMLElement) {
		const styleElement = document.querySelector('.monaco-editor-background');
		const {color, backgroundColor, fontFamily, fontWeight, fontSize} = window.getComputedStyle(styleElement);
		div.style.color = color;
		div.style.backgroundColor = backgroundColor;
		div.style.fontFamily = fontFamily;
		div.style.fontWeight = fontWeight;
		div.style.fontSize = fontSize;
	}

	private expandMacros(input: string) {
		return input.replace(/kb\(([a-z.\d\-]+)\)/gi, (match: string, kb: string) => {
			const keybinding = this.keybindingService.lookupKeybindings(kb)[0];
			const shortcut = keybinding ? this.keybindingService.getLabelFor(keybinding) : UNBOUND_COMMAND;
			return `<span class="shortcut">${shortcut}</span>`;
		});
	}

	private decorateContent() {
		const keys = this.content.querySelectorAll('.shortcut[data-command]');
		Array.prototype.forEach.call(keys, (key: Element) => {
			const command = key.getAttribute('data-command');
			const keybinding = command && this.keybindingService.lookupKeybindings(command)[0];
			const label = keybinding ? this.keybindingService.getLabelFor(keybinding) : UNBOUND_COMMAND;
			key.appendChild(document.createTextNode(label));
		});
	}
	private saveTextEditorViewState(resource: URI): void {
		const memento = this.getMemento(this.storageService, Scope.WORKSPACE);
		let editorViewStateMemento = memento[WALK_THROUGH_EDITOR_VIEW_STATE_PREFERENCE_KEY];
		if (!editorViewStateMemento) {
			editorViewStateMemento = Object.create(null);
			memento[WALK_THROUGH_EDITOR_VIEW_STATE_PREFERENCE_KEY] = editorViewStateMemento;
		}

		const editorViewState: IWalkThroughEditorViewState = {
			viewState: {
				scrollTop: this.scrollbar.getScrollTop(),
				scrollLeft: this.scrollbar.getScrollLeft()
			}
		};

		let fileViewState: IWalkThroughEditorViewStates = editorViewStateMemento[resource.toString()];
		if (!fileViewState) {
			fileViewState = Object.create(null);
			editorViewStateMemento[resource.toString()] = fileViewState;
		}

		if (typeof this.position === 'number') {
			fileViewState[this.position] = editorViewState;
		}
	}

	private loadTextEditorViewState(resource: URI) {
		const memento = this.getMemento(this.storageService, Scope.WORKSPACE);
		const editorViewStateMemento = memento[WALK_THROUGH_EDITOR_VIEW_STATE_PREFERENCE_KEY];
		if (editorViewStateMemento) {
			const fileViewState: IWalkThroughEditorViewStates = editorViewStateMemento[resource.toString()];
			if (fileViewState) {
				const state: IWalkThroughEditorViewState = fileViewState[this.position];
				if (state) {
					this.scrollbar.updateState(state.viewState);
				}
			}
		}
	}

	public clearInput(): void {
		if (this.input instanceof WalkThroughInput) {
			this.saveTextEditorViewState(this.input.getResource());
		}
		super.clearInput();
	}

	public shutdown(): void {
		if (this.input instanceof WalkThroughInput) {
			this.saveTextEditorViewState(this.input.getResource());
		}
		super.shutdown();
	}

	dispose(): void {
		this.contentDisposables = dispose(this.contentDisposables);
		this.disposables = dispose(this.disposables);
		super.dispose();
	}
}
