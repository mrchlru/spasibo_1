import React, { useEffect, useRef, useState } from 'react';
import { FaFileArrowUp, FaImage, FaTrashCan, FaXmark } from 'react-icons/fa6';
import {
  createFeedPost,
  updateFeedPost,
  uploadFeedPostDocument,
  uploadFeedPostImage,
} from '../api';
import styles from './FeedPostModal.module.css';

const MIN_TITLE_LENGTH = 3;
const MAX_TITLE_LENGTH = 255;
const MAX_BODY_LENGTH = 5000;
const MAX_ATTACHMENTS = 10;

const DOCUMENT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';

function revokePreviewUrl(attachment) {
  if (attachment.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

function isPersistableAttachmentUrl(url) {
  return typeof url === 'string' && url.length > 0 && !url.startsWith('blob:');
}

function mapExistingAttachments(attachments = []) {
  return attachments.map((item, index) => ({
    clientId: `existing-${item.id}-${index}`,
    kind: item.kind,
    url: item.url,
    filename: item.filename,
    content_type: item.content_type,
    uploading: false,
  }));
}

function FeedPostModal({ isOpen, editPost, onClose, onSuccess }) {
  const panelRef = useRef(null);
  const [renderModal, setRenderModal] = useState(isOpen);
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [hideFromAll, setHideFromAll] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const imageInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const isEditMode = Boolean(editPost?.id);

  useEffect(() => {
    if (isOpen) {
      setRenderModal(true);
      setError('');
      setSubmitting(false);
      setTitle(editPost?.title || '');
      setBody(editPost?.body || '');
      setIsPinned(editPost?.is_pinned || false);
      setHideFromAll(editPost ? !editPost.is_published : false);
      setAttachments(editPost ? mapExistingAttachments(editPost.attachments) : []);
      window.requestAnimationFrame(() => setModalVisible(true));
      return undefined;
    }

    setModalVisible(false);
    const timer = window.setTimeout(() => {
      setAttachments((prev) => {
        prev.forEach(revokePreviewUrl);
        return [];
      });
      setRenderModal(false);
      setTitle('');
      setBody('');
      setIsPinned(false);
      setHideFromAll(false);
      setSubmitting(false);
      setError('');
    }, 280);
    return () => window.clearTimeout(timer);
  }, [isOpen, editPost]);

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const isUploading = attachments.some((item) => item.uploading);
  const canSubmit =
    trimmedTitle.length >= MIN_TITLE_LENGTH &&
    trimmedTitle.length <= MAX_TITLE_LENGTH &&
    trimmedBody.length <= MAX_BODY_LENGTH &&
    !submitting &&
    !isUploading;

  async function handleImageSelect(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || attachments.length >= MAX_ATTACHMENTS) return;

    const clientId = `image-${Date.now()}`;
    const previewUrl = URL.createObjectURL(file);
    setAttachments((prev) => [
      ...prev,
      {
        clientId,
        kind: 'image',
        url: previewUrl,
        previewUrl,
        filename: file.name,
        content_type: file.type || 'image/jpeg',
        uploading: true,
      },
    ]);

    try {
      const response = await uploadFeedPostImage(file);
      setAttachments((prev) =>
        prev.map((item) => {
          if (item.clientId !== clientId) return item;
          revokePreviewUrl(item);
          return {
            ...item,
            url: response.data.url,
            previewUrl: undefined,
            content_type: response.data.content_type,
            uploading: false,
          };
        }),
      );
    } catch {
      setAttachments((prev) => {
        const target = prev.find((item) => item.clientId === clientId);
        if (target) revokePreviewUrl(target);
        return prev.filter((item) => item.clientId !== clientId);
      });
      setError('Не удалось загрузить изображение');
    }
  }

  async function handleDocumentSelect(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || attachments.length >= MAX_ATTACHMENTS) return;

    const clientId = `document-${Date.now()}`;
    setAttachments((prev) => [
      ...prev,
      {
        clientId,
        kind: 'document',
        url: '',
        filename: file.name,
        content_type: file.type || null,
        uploading: true,
      },
    ]);

    try {
      const response = await uploadFeedPostDocument(file);
      setAttachments((prev) =>
        prev.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                url: response.data.url,
                filename: response.data.filename,
                content_type: response.data.content_type,
                uploading: false,
              }
            : item,
        ),
      );
    } catch {
      setAttachments((prev) => prev.filter((item) => item.clientId !== clientId));
      setError('Не удалось загрузить файл');
    }
  }

  function removeAttachment(clientId) {
    setAttachments((prev) => {
      const target = prev.find((item) => item.clientId === clientId);
      if (target) revokePreviewUrl(target);
      return prev.filter((item) => item.clientId !== clientId);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setError('');
    setSubmitting(true);
    const payloadAttachments = attachments
      .filter((item) => !item.uploading && isPersistableAttachmentUrl(item.url))
      .map((item, index) => ({
        kind: item.kind,
        url: item.url,
        filename: item.filename,
        content_type: item.content_type,
        sort_order: index,
      }));

    try {
      if (isEditMode) {
        await updateFeedPost(editPost.id, {
          title: trimmedTitle,
          body: trimmedBody || null,
          is_pinned: isPinned,
          attachments: payloadAttachments,
        });
      } else {
        await createFeedPost({
          title: trimmedTitle,
          body: trimmedBody || null,
          is_pinned: isPinned,
          is_published: !hideFromAll,
          attachments: payloadAttachments,
        });
      }
      onSuccess();
      onClose();
    } catch {
      setError(isEditMode ? 'Не удалось сохранить новость' : 'Не удалось опубликовать новость');
    } finally {
      setSubmitting(false);
    }
  }

  if (!renderModal) return null;

  return (
    <div
      className={`${styles.overlay} ${modalVisible ? styles.overlayVisible : ''}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`${styles.panel} ${modalVisible ? styles.panelVisible : ''}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{isEditMode ? 'Редактировать новость' : 'Новость в ленту'}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
            <FaXmark size={16} />
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.fieldLabel} htmlFor="feed-post-title">Заголовок</label>
          <input
            id="feed-post-title"
            className={styles.input}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Краткий заголовок"
          />

          <label className={styles.fieldLabel} htmlFor="feed-post-body">Текст</label>
          <textarea
            id="feed-post-body"
            className={styles.textarea}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={MAX_BODY_LENGTH}
            placeholder="Подробности новости"
          />

          <div className={styles.attachActions}>
            <button type="button" className={styles.attachBtn} onClick={() => imageInputRef.current?.click()}>
              <FaImage size={14} /> Фото
            </button>
            <button type="button" className={styles.attachBtn} onClick={() => documentInputRef.current?.click()}>
              <FaFileArrowUp size={14} /> Файл
            </button>
          </div>

          <input ref={imageInputRef} type="file" accept="image/*" className={styles.hiddenInput} onChange={handleImageSelect} />
          <input ref={documentInputRef} type="file" accept={DOCUMENT_ACCEPT} className={styles.hiddenInput} onChange={handleDocumentSelect} />

          {attachments.length > 0 && (
            <ul className={styles.attachmentList}>
              {attachments.map((attachment) => (
                <li key={attachment.clientId} className={styles.attachmentItem}>
                  <span>
                    {attachment.filename || (attachment.kind === 'image' ? 'Фото' : 'Документ')}
                    {attachment.uploading ? ' (загрузка…)' : ''}
                  </span>
                  <button type="button" onClick={() => removeAttachment(attachment.clientId)} aria-label="Удалить">
                    <FaTrashCan size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!isEditMode && (
            <label className={styles.checkRow}>
              <input type="checkbox" checked={hideFromAll} onChange={(event) => setHideFromAll(event.target.checked)} />
              <span>Скрыть от всех (черновик)</span>
            </label>
          )}

          <label className={styles.checkRow}>
            <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
            <span>Закрепить в ленте</span>
          </label>

          {error && <p className={styles.error}>{error}</p>}

          {!canSubmit && trimmedTitle.length > 0 && trimmedTitle.length < MIN_TITLE_LENGTH && (
            <p className={styles.hint}>Заголовок — минимум {MIN_TITLE_LENGTH} символа</p>
          )}

          <button type="submit" className={styles.submitBtn} disabled={!canSubmit}>
            {submitting ? 'Сохраняем…' : isEditMode ? 'Сохранить' : hideFromAll ? 'Сохранить черновик' : 'Опубликовать'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default FeedPostModal;
