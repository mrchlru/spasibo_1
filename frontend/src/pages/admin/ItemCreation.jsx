// frontend/src/pages/admin/ItemCreation.jsx

import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { clearCache } from '../../storage';
import {
  createMarketItem,
  getAllMarketItems,
  updateMarketItem,
  archiveMarketItem,
  getArchivedMarketItems,
  restoreMarketItem,
  deleteMarketItemPermanently,
  reorderMarketItems,
  uploadPrizeImage,
} from '../../api';
import AdminImageUrlField from '../../components/AdminImageUrlField';
import { FaArchive, FaTrash, FaPen } from 'react-icons/fa';
import { useModalAlert } from '../../contexts/ModalAlertContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import { useDragReorder } from '../../hooks/useDragReorder';
import styles from '../AdminPage.module.css';
import sortStyles from '../../components/SortableList.module.css';
import prizeStyles from './ItemCreationPrize.module.css';

function isPrizeImageUrl(value) {
  return typeof value === 'string' && value.includes('/market-prizes/');
}

const initialItemState = {
  name: '',
  description: '',
  price_rub: '',
  original_price_rub: '',
  stock: 1,
  image_url: '',
  is_auto_issuance: false,
  is_shared_gift: false,
  is_local_purchase: false,
  codes_text: '',
  added_stock: '',
  new_item_codes: '',
};

const ItemCreation = () => {
  const { showAlert } = useModalAlert();
  const { confirm } = useConfirmation();
  const [view, setView] = useState('active');
  const [items, setItems] = useState([]);
  const [archivedItems, setArchivedItems] = useState([]);
  const [form, setForm] = useState(initialItemState);
  const [editingItemId, setEditingItemId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [issuanceMode, setIssuanceMode] = useState('codes');
  const [prizeUrls, setPrizeUrls] = useState([]);
  const [prizeUploading, setPrizeUploading] = useState(false);
  const [prizeUploadDone, setPrizeUploadDone] = useState(0);
  const [prizeUploadTotal, setPrizeUploadTotal] = useState(0);
  const prizeFileInputRef = useRef(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
        const [activeRes, archivedRes] = await Promise.all([
            getAllMarketItems(),
            getArchivedMarketItems()
        ]);
        setItems(activeRes.data);
        setArchivedItems(archivedRes.data);
    } catch (error) {
        showAlert('Не удалось загрузить товары.', 'error');
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const persistOrder = useCallback(async (orderedIds) => {
    try {
      const response = await reorderMarketItems(orderedIds);
      setItems(response.data);
      clearCache('market');
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Не удалось сохранить порядок товаров.', 'error');
      await fetchItems();
      throw error;
    }
  }, [showAlert]);

  const {
    dragId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useDragReorder(items, setItems, persistOrder);

  const calculatedPrice = useMemo(() => {
      if (!form.price_rub || form.price_rub <= 0) return 0;
      return Math.round(form.price_rub / 30);
  }, [form.price_rub]);

  const calculatedOriginalPrice = useMemo(() => {
    if (!form.original_price_rub || form.original_price_rub <= 0) return 0;
    return Math.round(form.original_price_rub / 30);
  }, [form.original_price_rub]);

  const forecast = useMemo(() => {
      if (!calculatedPrice || calculatedPrice <= 0) return "-";
      const monthsNeeded = calculatedPrice / 50;
      if (monthsNeeded <= 1) return "около 1 месяца";
      if (monthsNeeded <= 18) return `около ${Math.round(monthsNeeded)} мес.`;
      const years = (monthsNeeded / 12).toFixed(1);
      return `около ${years} лет`;
  }, [calculatedPrice]);

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name === 'is_shared_gift' && checked) {
      setForm(prev => ({
        ...prev,
        [name]: checked,
        is_auto_issuance: false,
        is_local_purchase: false
      }));
    } else if (name === 'is_auto_issuance' && checked) {
      setForm(prev => ({
        ...prev,
        [name]: checked,
        is_shared_gift: false,
        is_local_purchase: false
      }));
    } else if (name === 'is_local_purchase' && checked) {
      setForm(prev => ({
        ...prev,
        [name]: checked,
        is_auto_issuance: false,
        is_shared_gift: false
      }));
    } else {
      setForm(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (prizeUploading) {
      showAlert('Дождитесь окончания загрузки картинок.', 'error');
      return;
    }
    setLoading(true);

    const isEditing = !!editingItemId;
    let itemDataToSend;

    try {
      if (isEditing) {
        const newCodes = form.is_auto_issuance
          ? (issuanceMode === 'images'
            ? prizeUrls
            : form.new_item_codes.split('\n').filter(Boolean))
          : [];
        itemDataToSend = {
          name: form.name,
          description: form.description,
          price: calculatedPrice,
          price_rub: parseInt(form.price_rub, 10),
          image_url: form.image_url,
          original_price: calculatedOriginalPrice > 0 ? calculatedOriginalPrice : null,
          is_shared_gift: form.is_shared_gift,
          is_local_purchase: form.is_local_purchase,
          added_stock: form.is_auto_issuance ? 0 : parseInt(form.added_stock, 10) || 0,
          new_item_codes: newCodes
        };
        
        await updateMarketItem(editingItemId, itemDataToSend);
        showAlert('Товар успешно обновлен!', 'success');
      } else {
        const codes = form.is_auto_issuance
          ? (issuanceMode === 'images'
            ? prizeUrls
            : form.codes_text.split('\n').filter(Boolean))
          : [];
        if (form.is_auto_issuance && codes.length === 0) {
          showAlert(
            issuanceMode === 'images'
              ? 'Загрузите хотя бы одну призовую картинку.'
              : 'Для товаров с автовыдачей добавьте хотя бы один код.',
            'error',
          );
          setLoading(false);
          return;
        }
        itemDataToSend = {
          name: form.name,
          description: form.description,
          price: calculatedPrice,
          price_rub: parseInt(form.price_rub, 10),
          stock: form.is_auto_issuance ? codes.length : parseInt(form.stock, 10),
          image_url: form.image_url,
          original_price: calculatedOriginalPrice > 0 ? calculatedOriginalPrice : null,
          is_auto_issuance: form.is_auto_issuance,
          is_shared_gift: form.is_shared_gift,
          is_local_purchase: form.is_local_purchase,
          item_codes: codes
        };
        await createMarketItem(itemDataToSend);
        showAlert('Товар успешно создан!', 'success');
      }
      resetForm();
      fetchItems();
      clearCache('market');
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Произошла ошибка.', 'error');
    } finally {
      setLoading(false);
    }
  };

  async function handlePrizeFilesSelected(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }
    const productName = String(form.name || '').trim();
    if (!productName) {
      showAlert('Сначала укажите название товара — от него зависит папка в хранилище.', 'error');
      return;
    }
    setPrizeUploading(true);
    setPrizeUploadDone(0);
    setPrizeUploadTotal(files.length);
    const uploaded = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const response = await uploadPrizeImage(file, productName);
        uploaded.push(response.data.url);
        setPrizeUploadDone(index + 1);
      }
      setPrizeUrls((prev) => [...prev, ...uploaded]);
      showAlert(`Загружено картинок: ${uploaded.length}`, 'success');
    } catch (error) {
      showAlert(error.response?.data?.detail || 'Не удалось загрузить одну из картинок.', 'error');
      if (uploaded.length > 0) {
        setPrizeUrls((prev) => [...prev, ...uploaded]);
      }
    } finally {
      setPrizeUploading(false);
      setPrizeUploadDone(0);
      setPrizeUploadTotal(0);
    }
  }

  const handleEdit = (item) => {
    setEditingItemId(item.id);
    const codeValues = item.codes ? item.codes.map((c) => c.code_value) : [];
    const prizeCodeValues = codeValues.filter(isPrizeImageUrl);
    setIssuanceMode(prizeCodeValues.length > 0 ? 'images' : 'codes');
    setPrizeUrls([]);
    setForm({
        name: item.name,
        description: item.description || '',
        price_rub: item.price_rub,
        original_price_rub: item.original_price ? item.original_price * 30 : '',
        stock: item.stock,
        image_url: item.image_url || '',
        is_auto_issuance: item.is_auto_issuance,
        is_shared_gift: item.is_shared_gift || false,
        is_local_purchase: item.is_local_purchase || false,
        codes_text: codeValues.join('\n'),
        added_stock: '',
        new_item_codes: '',
    });
    window.scrollTo(0, 0);
  };

  const resetForm = () => {
    setForm(initialItemState);
    setEditingItemId(null);
    setIssuanceMode('codes');
    setPrizeUrls([]);
    setPrizeUploading(false);
    setPrizeUploadDone(0);
    setPrizeUploadTotal(0);
  };
  
  const handleArchive = async (itemId) => {
    const isConfirmed = await confirm('Архивация', 'Вы уверены, что хотите архивировать этот товар?');
    if (isConfirmed) {
        try {
            await archiveMarketItem(itemId);
            showAlert('Товар архивирован.', 'success');
            fetchItems();
            clearCache('market');
        } catch (error) {
            showAlert('Ошибка архивации.', 'error');
        }
    }
  };

  const handleRestore = async (itemId) => {
    const isConfirmed = await confirm('Восстановление', 'Вы уверены, что хотите восстановить этот товар?');
    if (isConfirmed) {
        try {
            await restoreMarketItem(itemId);
            showAlert('Товар восстановлен.', 'success');
            fetchItems();
            clearCache('market');
        } catch (error) {
            showAlert('Ошибка восстановления.', 'error');
        }
    }
  };

  const handleDeletePermanently = async (itemId, itemName) => {
    const isConfirmed = await confirm('ПОЛНОЕ УДАЛЕНИЕ', `Вы уверены, что хотите НАВСЕГДА удалить товар "${itemName}"? Это действие необратимо.`);
    if (isConfirmed) {
      setLoading(true);
      try {
        await deleteMarketItemPermanently(itemId);
        showAlert('Товар удален навсегда.', 'success');
        fetchItems();
        clearCache('market');
      } catch (error) {
        showAlert('Ошибка при удалении.', 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  function renderActiveList() {
    return (
      <>
        <p className={sortStyles.dragHint}>
          Зажмите ⋮⋮ и перетащите товар выше или ниже — так он отобразится в магазине у пользователей.
        </p>
        <ul className={sortStyles.sortableList}>
          {items.map((item, index) => (
            <li
              key={item.id}
              data-sortable-id={item.id}
              className={`${sortStyles.sortableRow} ${dragId === item.id ? sortStyles.sortableRowDragging : ''}`}
              draggable
              onDragStart={() => handleDragStart(item.id)}
              onDragOver={(event) => handleDragOver(event, item.id)}
              onDragEnd={() => {
                void handleDragEnd().catch(() => undefined);
              }}
              onTouchStart={(event) => handleTouchStart(event, item.id)}
              onTouchMove={handleTouchMove}
              onTouchEnd={() => {
                void handleTouchEnd().catch(() => undefined);
              }}
            >
              <span className={sortStyles.dragHandle} aria-hidden="true">
                ⋮⋮
              </span>
              <span className={sortStyles.orderBadge}>{index + 1}</span>
              {item.image_url ? (
                <img src={item.image_url} alt="" className={sortStyles.rowThumb} loading="lazy" />
              ) : (
                <span className={sortStyles.rowThumb} aria-hidden="true" />
              )}
              <div className={sortStyles.rowBody}>
                <strong>{item.name}</strong>
                {item.is_auto_issuance && <span style={{ color: '#007bff' }}>Автовыдача</span>}
                {item.is_shared_gift && <span style={{ color: '#28a745' }}>Совместный подарок</span>}
                {item.is_local_purchase && <span style={{ color: '#ff9800' }}>Локальный подарок</span>}
                {item.original_price && item.original_price > item.price ? (
                  <span>
                    Цена: {item.price} (было <s style={{ color: '#999' }}>{item.original_price}</s>) спасибок
                  </span>
                ) : (
                  <span>
                    Цена: {item.price} спасибок ({item.price_rub} ₽)
                  </span>
                )}
                <span>Остаток: {item.stock} шт.</span>
              </div>
              <div
                className={styles.listItemActions}
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
              >
                <button type="button" onClick={() => handleEdit(item)} className={styles.buttonSmall} aria-label="Редактировать">
                  <FaPen size={12} />
                </button>
                <button type="button" onClick={() => handleArchive(item.id)} className={styles.buttonSmallRed} aria-label="В архив">
                  <FaTrash size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  function renderArchivedList() {
    return (
      <div className={styles.list}>
        {archivedItems.map((item) => (
          <div key={item.id} className={styles.listItem}>
            {item.image_url && <img src={item.image_url} alt={item.name} className={styles.listItemImage} loading="lazy" />}
            <div className={styles.listItemContent}>
              <p><strong>{item.name}</strong></p>
              <p>Цена: {item.price} спасибок ({item.price_rub} ₽)</p>
              <p>Остаток: {item.stock} шт.</p>
            </div>
            <div className={styles.listItemActions}>
              <button type="button" onClick={() => handleRestore(item.id)} className={styles.restoreButton}>
                <FaArchive />
                Восстановить
              </button>
              <button type="button" onClick={() => handleDeletePermanently(item.id, item.name)} className={styles.buttonSmallRed}>
                <FaTrash /> Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className={styles.card}>
        <h2>{editingItemId ? 'Редактирование товара' : 'Создать новый товар'}</h2>
        <form onSubmit={handleFormSubmit}>
          <AdminImageUrlField
            value={form.image_url}
            onChange={(v) => setForm((prev) => ({ ...prev, image_url: v }))}
            placeholder="Ссылка на изображение (URL) 1080×720px или загрузка (AVIF)"
            urlHint="Загрузка: конвертация в AVIF и сохранение в объектное хранилище."
          />
          
          <input type="text" name="name" value={form.name} onChange={handleFormChange} placeholder="Название товара" className={styles.input} required />

          <div className={styles.descriptionWrapper}>
            <textarea
              name="description"
              placeholder="Описание"
              value={form.description}
              onChange={handleFormChange}
              maxLength="300"
              className={styles.textarea}
            />
            <span className={styles.charCounter}>{(form.description || '').length} / 300</span>
          </div>
          
          <input type="number" name="price_rub" value={form.price_rub} onChange={handleFormChange} placeholder="Цена в рублях" className={styles.input} required min="0" />
          <input type="number" name="original_price_rub" value={form.original_price_rub} onChange={handleFormChange} placeholder="Старая цена в рублях (для скидки)" className={styles.input} min="0" />
          
          {(form.price_rub > 0 || form.original_price_rub > 0) && (
              <div className={styles.pricePreview}>
                <p>Цена в спасибках: <strong>{calculatedPrice}</strong></p>
                {calculatedOriginalPrice > 0 && (
                  <p>Старая цена в спасибках: <strong>{calculatedOriginalPrice}</strong></p>
                )}
                <p>
                  Прогноз накопления
                  <span style={{color: '#5CA14A', fontWeight: '500'}}>
                    {calculatedOriginalPrice > 0 ? " (по скидке)" : ""}
                  </span>: 
                  <strong> {forecast}</strong>
                </p>
              </div>
          )}

          <div className={styles.checkboxContainer}>
            <input
              type="checkbox"
              id="is_auto_issuance"
              name="is_auto_issuance"
              checked={form.is_auto_issuance}
              onChange={handleFormChange}
              disabled={!!editingItemId || form.is_shared_gift || form.is_local_purchase} 
            />
            <label htmlFor="is_auto_issuance">Автовыдача товара (сертификаты, коды)</label>
          </div>

          <div className={styles.checkboxContainer}>
            <input
              type="checkbox"
              id="is_shared_gift"
              name="is_shared_gift"
              checked={form.is_shared_gift}
              onChange={handleFormChange}
              disabled={!!editingItemId || form.is_auto_issuance || form.is_local_purchase} 
            />
            <label htmlFor="is_shared_gift">Совместный подарок</label>
          </div>

          <div className={styles.checkboxContainer}>
            <input
              type="checkbox"
              id="is_local_purchase"
              name="is_local_purchase"
              checked={form.is_local_purchase}
              onChange={handleFormChange}
              disabled={!!editingItemId || form.is_auto_issuance || form.is_shared_gift} 
            />
            <label htmlFor="is_local_purchase">Локальный подарок</label>
          </div>

          {form.is_auto_issuance ? (
            <>
              <div className={prizeStyles.issuanceModes}>
                <button
                  type="button"
                  className={`${prizeStyles.modeBtn} ${issuanceMode === 'codes' ? prizeStyles.modeBtnActive : ''}`}
                  onClick={() => setIssuanceMode('codes')}
                  disabled={prizeUploading}
                >
                  Коды / ссылки
                </button>
                <button
                  type="button"
                  className={`${prizeStyles.modeBtn} ${issuanceMode === 'images' ? prizeStyles.modeBtnActive : ''}`}
                  onClick={() => setIssuanceMode('images')}
                  disabled={prizeUploading}
                >
                  Картинки (JPEG в S3)
                </button>
              </div>

              {issuanceMode === 'codes' ? (
                <>
                  {editingItemId ? (
                    <textarea
                      name="new_item_codes"
                      value={form.new_item_codes}
                      onChange={handleFormChange}
                      placeholder="Добавить новые коды/ссылки (каждый с новой строки)"
                      className={styles.textarea}
                      rows={4}
                    />
                  ) : (
                    <textarea
                      name="codes_text"
                      value={form.codes_text}
                      onChange={handleFormChange}
                      placeholder="Вставьте сюда коды или ссылки. Каждый код с новой строки."
                      className={styles.textarea}
                      rows={5}
                    />
                  )}
                  <div className={styles.pricePreview}>
                    <p>Текущий остаток: <strong>{editingItemId ? form.stock : '...'}</strong></p>
                    <p>
                      Будет добавлено:{' '}
                      <strong>
                        {(editingItemId ? form.new_item_codes : form.codes_text)
                          .split('\n')
                          .filter(Boolean).length}
                      </strong>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className={prizeStyles.hint}>
                    Картинки сохраняются в JPEG (без AVIF), чтобы их можно было открыть и скачать
                    на телефоне. Папка в хранилище называется по названию товара
                    {form.name.trim() ? ` («${form.name.trim()}»)` : ''}.
                    {editingItemId
                      ? ' Здесь добавляются новые картинки к уже существующим призам.'
                      : ''}
                  </p>
                  {!form.name.trim() && (
                    <p className={prizeStyles.nameRequiredHint}>
                      Сначала заполните поле «Название товара» выше — без него загрузка недоступна.
                    </p>
                  )}
                  <div className={prizeStyles.uploadRow}>
                    <input
                      ref={prizeFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className={prizeStyles.hiddenFile}
                      onChange={(event) => {
                        void handlePrizeFilesSelected(event);
                      }}
                    />
                    <button
                      type="button"
                      className={styles.buttonGrey}
                      disabled={prizeUploading}
                      onClick={() => {
                        if (!form.name.trim()) {
                          showAlert('Сначала укажите название товара — от него зависит папка в хранилище.', 'error');
                          return;
                        }
                        prizeFileInputRef.current?.click();
                      }}
                    >
                      {prizeUploading ? 'Загрузка…' : 'Выбрать картинки'}
                    </button>
                  </div>
                  {prizeUploading && (
                    <div className={prizeStyles.progressBox} aria-live="polite">
                      <span className={prizeStyles.spinner} aria-hidden="true" />
                      <span className={prizeStyles.progressText}>
                        Загружено {prizeUploadDone} из {prizeUploadTotal}
                      </span>
                    </div>
                  )}
                  {prizeUrls.length > 0 && (
                    <div className={prizeStyles.thumbGrid}>
                      {prizeUrls.map((url) => (
                        <div key={url} className={prizeStyles.thumbCard}>
                          <img src={url} alt="" className={prizeStyles.thumb} loading="lazy" />
                          <button
                            type="button"
                            className={prizeStyles.removeThumb}
                            aria-label="Удалить"
                            disabled={prizeUploading}
                            onClick={() =>
                              setPrizeUrls((prev) => prev.filter((item) => item !== url))
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={styles.pricePreview}>
                    <p>Текущий остаток: <strong>{editingItemId ? form.stock : '...'}</strong></p>
                    <p>
                      Будет добавлено картинок: <strong>{prizeUrls.length}</strong>
                    </p>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {editingItemId ? (
                <input type="number" name="added_stock" value={form.added_stock} onChange={handleFormChange} placeholder={`Текущий остаток: ${form.stock}. Добавить еще:`} className={styles.input} min="0" />
              ) : (
                <input type="number" name="stock" value={form.stock} onChange={handleFormChange} placeholder="Количество на складе" className={styles.input} required min="0" />
              )}
            </>
          )}

          <button type="submit" disabled={loading || prizeUploading} className={styles.buttonGreen}>
            {editingItemId ? 'Сохранить' : 'Создать'}
          </button>
          {editingItemId && <button type="button" onClick={resetForm} className={styles.buttonGrey}>Отмена</button>}
        </form>
      </div>
      
      <div className={styles.tabs}>
        <button onClick={() => setView('active')} className={view === 'active' ? styles.tabActive : styles.tab}>Активные ({items.length})</button>
        <button onClick={() => setView('archived')} className={view === 'archived' ? styles.tabActive : styles.tab}>Архив ({archivedItems.length})</button>
      </div>

       <div className={styles.card}>
        <h2>{view === 'active' ? 'Активные товары' : 'Архив товаров'}</h2>
        {view === 'active' ? renderActiveList() : renderArchivedList()}
      </div>
    </>
  );
};

export default ItemCreation;
