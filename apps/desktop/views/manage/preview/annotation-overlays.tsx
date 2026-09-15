import { AppTooltip } from '@/packages/core-ui/app-tooltip';
import { formatSidebarHotkeyLabel } from '@/packages/core-ui/hotkey-label';
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useRef,
} from 'react';
import { IconCheck, IconFolders, IconMessagePlus, IconPencil, IconSend, IconX } from '@tabler/icons-react';
import { Bold as MeoBoldIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  MANAGE_COMMENT_ANNOTATION_COLOR,
  MANAGE_DISMISS_TOOLBAR_COLOR,
  MANAGE_MEO_HEADING_COLOR,
  MANAGE_QUICK_LABELS,
} from '../constants';
import {
  ManageAnnotation,
  ManageAnnotationPreview,
  ManageCommentDraft,
  ManageQuickLabel,
  ManageSelectionAnchor,
} from '../types';
import { type ManageAnnotationReviewCounts, isManageAnnotationPending } from '../annotation-store';
import { ManageTooltipButton } from '../manage-tooltip-button';
import {
  annotationDisplayNote,
  annotationPreviewCardStyle,
  annotationPreviewText,
  annotationTypeLabel,
  clampManageSelectionToolbarLeft,
  commentPopoverStyle,
  manageAnnotationColor,
  manageToolbarActionStyle,
  renderManageQuickLabelIcon,
} from '../annotation-store';

/** CDXC:Docs 2026-09-14 WHY: Annotation highlight colors are pale on purpose, but toolbar icons need darker shades of the same hues to stay visible on a light background. */
const QUICK_LABEL_LIGHT_ICON_COLORS: Record<ManageQuickLabel['id'], string> = {
  clarify: '#7c3aed',
  'needs-tests': '#b45309',
  'looks-good': '#15803d',
};

export function ManageAnnotationToolbar({
  anchor,
  onComment,
  onDismiss,
  onFormatting,
  onQuickLabel,
}: {
  anchor: ManageSelectionAnchor;
  onComment: () => void;
  onDismiss: () => void;
  onFormatting: () => void;
  onQuickLabel: (label: ManageQuickLabel) => void;
}) {
  return createPortal(
    <div
      className='manage-markdown-selection-toolbar'
      style={{
        left: clampManageSelectionToolbarLeft(anchor.left),
        top: Math.max(8, anchor.top - 46),
      }}
    >
      <AppTooltip content='Comment' side='top'>
        <button
          aria-label='Comment'
          onClick={onComment}
          style={manageToolbarActionStyle(MANAGE_COMMENT_ANNOTATION_COLOR, '#926b0e')}
          type='button'
        >
          <IconMessagePlus aria-hidden='true' size={15} />
        </button>
      </AppTooltip>
      <AppTooltip content='Formatting' side='top'>
        <button
          aria-label='Formatting'
          onClick={onFormatting}
          style={manageToolbarActionStyle(MANAGE_MEO_HEADING_COLOR, '#3f3f46')}
          type='button'
        >
          <MeoBoldIcon aria-hidden='true' size={15} />
        </button>
      </AppTooltip>
      {MANAGE_QUICK_LABELS.map((label) => (
        <AppTooltip content={label.text} key={label.id} side='top'>
          <button
            aria-label={label.text}
            onClick={() => onQuickLabel(label)}
            style={manageToolbarActionStyle(label.color, QUICK_LABEL_LIGHT_ICON_COLORS[label.id])}
            type='button'
          >
            {renderManageQuickLabelIcon(label.id)}
          </button>
        </AppTooltip>
      ))}
      <AppTooltip content='Dismiss' side='top'>
        <button
          aria-label='Dismiss'
          onClick={onDismiss}
          style={manageToolbarActionStyle(MANAGE_DISMISS_TOOLBAR_COLOR, '#dc2626')}
          type='button'
        >
          <IconX aria-hidden='true' size={15} />
        </button>
      </AppTooltip>
    </div>,
    document.body
  );
}

export function ManageAnnotationPreviewCard({
  onRemoveAnnotation,
  preview,
}: {
  onRemoveAnnotation: (annotationId: string) => void;
  preview: ManageAnnotationPreview;
}) {
  const annotation = preview.annotation;
  const note = annotationPreviewText(annotation);
  return createPortal(
    <aside
      className='manage-annotation-preview-card'
      data-label-id={annotation.labelId}
      data-type={annotation.type}
      style={
        {
          ...annotationPreviewCardStyle(preview.anchor),
          '--manage-annotation-color': manageAnnotationColor(annotation),
        } as CSSProperties
      }
    >
      <header>
        <span>{annotationTypeLabel(annotation)}</span>
        {annotation.attachments.length > 0 ? (
          <span>
            {annotation.attachments.length} {annotation.attachments.length === 1 ? 'image' : 'images'}
          </span>
        ) : null}
      </header>
      <ManageTooltipButton
        aria-label='Remove annotation'
        className='manage-annotation-preview-remove-button manage-icon-button'
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          onRemoveAnnotation(annotation.id);
        }}
        onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        tooltip='Remove annotation'
        type='button'
      >
        <IconX aria-hidden='true' size={14} />
      </ManageTooltipButton>
      <p>{note}</p>
    </aside>,
    document.body
  );
}

export function ManageCommentPopover({
  draft,
  onAddAttachmentFiles,
  onCancel,
  onDraftNoteChange,
  onRemoveDraftAttachment,
  onSubmit,
  submitLabel = 'Add',
}: {
  draft: ManageCommentDraft;
  onAddAttachmentFiles: (files: FileList | File[]) => void;
  onCancel: () => void;
  onDraftNoteChange: (note: string) => void;
  onRemoveDraftAttachment: (attachmentId: string) => void;
  onSubmit: () => void;
  /**
   * CDXC:Docs 2026-09-15 DECISION:
   * User: the composer button says "Add" while annotating, not "Submit", because a note is added to the list of annotations and only the Send action submits them to the agent.
   * The button shows the OS chord (Cmd+Enter, Ctrl+Enter on Windows and Linux) that adds the note, and stays "Save" when editing an existing note.
   */
  submitLabel?: string;
}) {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const canSubmit = Boolean(draft.note.trim()) || draft.attachments.length > 0;
  const submitChordLabel = formatSidebarHotkeyLabel('cmd+enter');
  return createPortal(
    <div className='manage-comment-popover' style={commentPopoverStyle(draft.anchor)}>
      <ManageTooltipButton
        aria-label='Close comment composer'
        className='manage-comment-popover-close manage-icon-button'
        onClick={onCancel}
        tooltip='Close'
        type='button'
      >
        <IconX aria-hidden='true' size={14} />
      </ManageTooltipButton>
      <textarea
        aria-label='Annotation note'
        autoFocus
        onChange={(event) => onDraftNoteChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            /*
             * CDXC:Docs 2026-09-15 WHY:
             * The chord must not reach the window. Adding the note closes the composer, React commits that before the native event bubbles on, and the document-level Cmd+Enter "send" listener mounts in time to receive the same keypress, which sent the notes and switched the app to the Agents view.
             */
            event.preventDefault();
            event.stopPropagation();
            if (canSubmit) {
              onSubmit();
            }
          }
        }}
        placeholder={draft.quote ? 'Add a comment' : 'Add a global comment'}
        value={draft.note}
      />
      {draft.attachments.length > 0 ? (
        <div className='manage-attachment-strip'>
          {draft.attachments.map((attachment) => (
            <figure className='manage-attachment-chip' key={attachment.id}>
              <img alt='' src={attachment.dataUrl} />
              <figcaption>{attachment.name}</figcaption>
              <button
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onRemoveDraftAttachment(attachment.id)}
                type='button'
              >
                <IconX aria-hidden='true' size={12} />
              </button>
            </figure>
          ))}
        </div>
      ) : null}
      {draft.attachmentError ? <div className='manage-attachment-error'>{draft.attachmentError}</div> : null}
      <div className='manage-comment-popover-actions'>
        {/*
         * CDXC:Docs 2026-06-28-08:31:
         * The Image action in the Markdown annotation comment composer is hidden because the current picker does not open from this surface. Keep the button source commented so the picker flow can be restored when it is fixed instead of deleting the intended UI.
         *
         * <button
         *   className="manage-comment-popover-image-button"
         *   onClick={() => attachmentInputRef.current?.click()}
         *   type="button"
         * >
         *   <IconPhoto aria-hidden="true" size={14} />
         *   Image
         * </button>
         */}
        <button className='manage-comment-popover-submit' disabled={!canSubmit} onClick={onSubmit} type='button'>
          <IconMessagePlus aria-hidden='true' size={14} />
          {submitLabel}
          <kbd aria-label={`Shortcut ${submitChordLabel}`}>{submitChordLabel}</kbd>
        </button>
      </div>
      <input
        accept='image/*'
        aria-label='Annotation image attachments'
        className='manage-hidden-file-input'
        multiple
        onChange={(event) => {
          if (event.currentTarget.files) {
            onAddAttachmentFiles(event.currentTarget.files);
          }
          event.currentTarget.value = '';
        }}
        ref={attachmentInputRef}
        type='file'
      />
    </div>,
    document.body
  );
}

export function ManageAnnotationDropdown({
  annotations,
  onEditAnnotation,
  onRemoveAnnotation,
}: {
  annotations: ManageAnnotation[];
  onEditAnnotation: (annotationId: string) => void;
  onRemoveAnnotation: (annotationId: string) => void;
}) {
  return (
    <div
      aria-label='Annotations'
      className='manage-annotation-dropdown'
      id='manage-markdown-annotation-dropdown'
      role='dialog'
    >
      <header>
        <span>Annotations</span>
      </header>
      <div className='manage-annotation-dropdown-list'>
        {annotations.length === 0 ? <div className='manage-annotation-empty'>No annotations</div> : null}
        {annotations.map((annotation) => {
          const note = annotationDisplayNote(annotation);
          const sent = !isManageAnnotationPending(annotation);
          return (
            <article
              className='manage-annotation-card'
              data-label-id={annotation.labelId}
              data-sent={String(sent)}
              data-type={annotation.type}
              key={annotation.id}
              style={{ '--manage-annotation-color': manageAnnotationColor(annotation) } as CSSProperties}
            >
              <div className='manage-annotation-card-header'>
                <span>
                  {annotationTypeLabel(annotation)}
                  {sent ? (
                    <span
                      className='manage-annotation-sent-pill'
                      title='Already sent to the agent; editing sends it again'
                    >
                      <IconCheck aria-hidden='true' size={11} />
                      Sent
                    </span>
                  ) : null}
                </span>
                {annotation.type === 'comment' ? (
                  <ManageTooltipButton
                    aria-label='Edit annotation'
                    className='manage-annotation-edit-button manage-icon-button'
                    onClick={() => onEditAnnotation(annotation.id)}
                    tooltip='Edit note'
                    type='button'
                  >
                    <IconPencil aria-hidden='true' size={14} />
                  </ManageTooltipButton>
                ) : null}
                <ManageTooltipButton
                  aria-label='Remove annotation'
                  className='manage-annotation-remove-button manage-icon-button'
                  onClick={() => onRemoveAnnotation(annotation.id)}
                  tooltip='Remove annotation'
                  type='button'
                >
                  <IconX aria-hidden='true' size={14} />
                </ManageTooltipButton>
              </div>
              {annotation.scope === 'selection' ? <blockquote>{annotation.quote}</blockquote> : null}
              {note ? <p>{note}</p> : null}
              {annotation.attachments.length > 0 ? (
                <div className='manage-annotation-attachments'>
                  {annotation.attachments.map((attachment) => (
                    <a href={attachment.dataUrl} key={attachment.id} rel='noreferrer' target='_blank'>
                      <img alt='' src={attachment.dataUrl} />
                      <span>{attachment.name}</span>
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Review menu: the actions that send notes again or across files, each
 * with a live count, dimmed when there is nothing for it to act on.
 */
export function ManageReviewMenu({
  counts,
  folderPending,
  onResendAll,
  onSendAcrossFiles,
}: {
  counts: ManageAnnotationReviewCounts;
  folderPending: { count: number; fileCount: number };
  onResendAll: () => void;
  onSendAcrossFiles: () => void;
}) {
  const activeCount = counts.pending + counts.sent;
  const rows: Array<{
    description: string;
    disabled: boolean;
    icon: ReactNode;
    label: string;
    onSelect: () => void;
  }> = [
    ...(folderPending.fileCount > 1
      ? [
          {
            description: `${folderPending.count} new in ${folderPending.fileCount} files`,
            disabled: false,
            icon: <IconFolders aria-hidden='true' size={15} />,
            label: 'Send new across all files',
            onSelect: onSendAcrossFiles,
          },
        ]
      : []),
    {
      description: `${counts.sent} sent, ${counts.pending} new`,
      disabled: activeCount === 0,
      icon: <IconSend aria-hidden='true' size={15} />,
      label: 'Resend all',
      onSelect: onResendAll,
    },
  ];
  return (
    <div
      aria-label='Review actions'
      className='manage-annotation-dropdown manage-review-menu'
      id='manage-markdown-review-menu'
      role='menu'
    >
      <header>
        <span>Review</span>
      </header>
      <div className='manage-review-menu-list'>
        {rows.map((row) => (
          <button
            className='manage-review-menu-row'
            disabled={row.disabled}
            key={row.label}
            onClick={row.onSelect}
            role='menuitem'
            type='button'
          >
            {row.icon}
            <span className='manage-review-menu-row-label'>{row.label}</span>
            <span className='manage-review-menu-row-description'>{row.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
