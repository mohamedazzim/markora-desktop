import { useEffect, useRef, type ClipboardEvent, type DragEvent } from 'react';
import CodeMirror, { type ViewUpdate } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SearchHighlightData } from '../search/DocumentSearchPanel';

const setSearchHighlights = StateEffect.define<{
  ranges: Array<{ from: number; to: number; active: boolean }>;
}>();
const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSearchHighlights)) continue;
      const ranges: Array<Range<Decoration>> = effect.value.ranges
        .filter(
          (range) => range.to > range.from && range.from >= 0 && range.to <= transaction.state.doc.length,
        )
        .map((range) =>
          Decoration.mark({ class: range.active ? 'cm-search-match active' : 'cm-search-match' }).range(
            range.from,
            range.to,
          ),
        );
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface EditorViewSnapshot {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}
export interface SourceEditorProps {
  source: string;
  viewState: EditorViewSnapshot;
  onChange(source: string): void;
  onViewStateChange(state: EditorViewSnapshot): void;
  onImageFiles?(files: File[], range: { from: number; to: number }): Promise<void> | void;
  spellcheckEnabled?: boolean;
  language?: string;
  searchHighlights?: SearchHighlightData;
  typewriterMode?: boolean;
  wordWrap?: boolean;
}

export function SourceEditor({
  source,
  viewState,
  onChange,
  onViewStateChange,
  onImageFiles,
  spellcheckEnabled = true,
  language,
  searchHighlights,
  typewriterMode = false,
  wordWrap = true,
}: SourceEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const stateRef = useRef(viewState);
  stateRef.current = viewState;
  const onViewStateChangeRef = useRef(onViewStateChange);
  onViewStateChangeRef.current = onViewStateChange;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const onScroll = () =>
      onViewStateChangeRef.current({
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
      });
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => view.scrollDOM.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const content = viewRef.current?.contentDOM;
    if (!content) return;
    content.spellcheck = spellcheckEnabled;
    if (language) content.lang = language;
    else content.removeAttribute('lang');
  }, [language, spellcheckEnabled]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setSearchHighlights.of({
        ranges: (searchHighlights?.matches || []).map((match, index) => ({
          from: match.start,
          to: match.end,
          active: index === searchHighlights?.activeIndex,
        })),
      }),
    });
  }, [searchHighlights]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const maximum = view.state.doc.length;
    const anchor = Math.min(viewState.anchor, maximum);
    const head = Math.min(viewState.head, maximum);
    const current = view.state.selection.main;
    if (current.anchor !== anchor || current.head !== head) {
      view.dispatch({ selection: { anchor, head }, scrollIntoView: !typewriterMode });
    }
    if (typewriterMode) {
      view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
    }
  }, [typewriterMode, viewState.anchor, viewState.head]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const frame = requestAnimationFrame(() => {
      if (!typewriterMode && view.scrollDOM.scrollTop !== viewState.scrollTop) {
        view.scrollDOM.scrollTop = viewState.scrollTop;
      }
      if (view.scrollDOM.scrollLeft !== viewState.scrollLeft) {
        view.scrollDOM.scrollLeft = viewState.scrollLeft;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [typewriterMode, viewState.scrollLeft, viewState.scrollTop]);
  const onCreateEditor = (view: EditorView) => {
    viewRef.current = view;
    const saved = stateRef.current;
    const maximum = view.state.doc.length;
    view.contentDOM.spellcheck = spellcheckEnabled;
    if (language) view.contentDOM.lang = language;
    view.dispatch({
      selection: { anchor: Math.min(saved.anchor, maximum), head: Math.min(saved.head, maximum) },
    });
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = saved.scrollTop;
      view.scrollDOM.scrollLeft = saved.scrollLeft;
    });
  };
  const onUpdate = (update: ViewUpdate) => {
    if (update.selectionSet)
      onViewStateChangeRef.current({
        anchor: update.state.selection.main.anchor,
        head: update.state.selection.main.head,
        scrollTop: update.view.scrollDOM.scrollTop,
        scrollLeft: update.view.scrollDOM.scrollLeft,
      });
  };
  const imageFiles = (files: FileList) =>
    Array.from(files).filter(
      (file) =>
        file.type.startsWith('image/') || /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name),
    );
  const pasteImages = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = imageFiles(event.clipboardData.files);
    if (!files.length || !onImageFiles) return;
    event.preventDefault();
    const selection = viewRef.current?.state.selection.main;
    void onImageFiles(files, { from: selection?.from ?? 0, to: selection?.to ?? 0 });
  };
  const dropImages = (event: DragEvent<HTMLDivElement>) => {
    const files = imageFiles(event.dataTransfer.files);
    if (!files.length || !onImageFiles) return;
    event.preventDefault();
    const view = viewRef.current;
    const position = view?.posAtCoords({ x: event.clientX, y: event.clientY });
    const offset = position ?? view?.state.selection.main.head ?? 0;
    void onImageFiles(files, { from: offset, to: offset });
  };
  return (
    <div
      className="source"
      onPasteCapture={pasteImages}
      onDragOver={(event) => {
        if (imageFiles(event.dataTransfer.files).length) event.preventDefault();
      }}
      onDropCapture={dropImages}
    >
      <CodeMirror
        className="markora-editor"
        value={source}
        height="100%"
        extensions={[
          markdown(),
          searchHighlightField,
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown source editor',
            'aria-multiline': 'true',
          }),
          ...(wordWrap ? [EditorView.lineWrapping] : []),
        ]}
        onChange={onChange}
        onCreateEditor={onCreateEditor}
        onUpdate={onUpdate}
        basicSetup={{
          lineNumbers: true,
          bracketMatching: true,
          foldGutter: true,
          highlightActiveLine: true,
          autocompletion: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}
