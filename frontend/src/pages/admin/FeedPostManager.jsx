import React, { useCallback, useEffect, useState } from 'react';
import { FaPen, FaTrash } from 'react-icons/fa';
import {
  deleteFeedPost,
  getAdminFeedPosts,
  publishFeedPost,
} from '../../api';
import FeedPostModal from '../../components/FeedPostModal';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import styles from './FeedPostManager.module.css';

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function FeedPostManager() {
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPost, setEditingPost] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAdminFeedPosts();
      setPosts(response.data ?? []);
    } catch {
      showAlert('Не удалось загрузить новости', 'error');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  function openEdit(post) {
    setEditingPost(post);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingPost(null);
  }

  async function handleDelete(post) {
    const isConfirmed = await confirm(`Удалить новость «${post.title}»?`);
    if (!isConfirmed) return;

    setDeletingId(post.id);
    try {
      await deleteFeedPost(post.id);
      setPosts((prev) => prev.filter((item) => item.id !== post.id));
      showAlert('Новость удалена', 'success');
    } catch (error) {
      const detail = error.response?.data?.detail;
      showAlert(typeof detail === 'string' ? detail : 'Не удалось удалить новость', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePublish(post) {
    try {
      await publishFeedPost(post.id);
      await loadPosts();
      showAlert('Новость опубликована', 'success');
    } catch (error) {
      const detail = error.response?.data?.detail;
      showAlert(typeof detail === 'string' ? detail : 'Не удалось опубликовать', 'error');
    }
  }

  if (loading) {
    return <p>Загрузка новостей…</p>;
  }

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>Новости ленты</h2>
      <p className={styles.subtitle}>
        Все активные новости. Удалённые скрываются из списка и ленты.
      </p>

      {posts.length === 0 ? (
        <p className={styles.empty}>Новостей пока нет.</p>
      ) : (
        <ul className={styles.list}>
          {posts.map((post) => {
            const author = post.author;
            const authorLabel = author
              ? `@${author.username || author.first_name || 'автор'}`
              : '—';
            const previewImage = (post.attachments || []).find((item) => item.kind === 'image');

            return (
              <li key={post.id} className={styles.card}>
                <div className={styles.cardMain}>
                  {previewImage?.url ? (
                    <img
                      src={previewImage.url}
                      alt=""
                      className={styles.thumb}
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles.thumbFallback} aria-hidden="true" />
                  )}
                  <div className={styles.cardBody}>
                    <div className={styles.cardTop}>
                      <h3 className={styles.cardTitle}>{post.title}</h3>
                      <div className={styles.badges}>
                        {!post.is_published && <span className={styles.badgeDraft}>Черновик</span>}
                        {post.is_pinned && <span className={styles.badgePinned}>Закреплено</span>}
                      </div>
                    </div>
                    {post.body && <p className={styles.cardText}>{post.body}</p>}
                    <p className={styles.meta}>
                      {authorLabel} · {formatDate(post.published_at || post.created_at)}
                    </p>
                  </div>
                </div>
                <div className={styles.actions}>
                  {!post.is_published && (
                    <button type="button" className={styles.publishBtn} onClick={() => void handlePublish(post)}>
                      Опубликовать
                    </button>
                  )}
                  <button type="button" className={styles.iconBtn} onClick={() => openEdit(post)} aria-label="Редактировать">
                    <FaPen size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtnDanger}
                    onClick={() => void handleDelete(post)}
                    disabled={deletingId === post.id}
                    aria-label="Удалить"
                  >
                    <FaTrash size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <FeedPostModal
        isOpen={modalOpen}
        editPost={editingPost}
        onClose={closeModal}
        onSuccess={() => {
          void loadPosts();
        }}
      />
    </div>
  );
}

export default FeedPostManager;
