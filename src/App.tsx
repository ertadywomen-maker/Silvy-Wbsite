/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  setDoc, 
  deleteDoc, 
  addDoc, 
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL 
} from 'firebase/storage';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { db, auth, storage } from './firebase';
import { Category, Product, OperationType, FirestoreErrorInfo } from './types';
import { 
  ShoppingBag, 
  Plus, 
  LogOut, 
  LogIn, 
  Filter, 
  CheckCircle2, 
  Download, 
  MessageCircle, 
  Trash2, 
  Edit2, 
  X,
  Search,
  ChevronRight,
  Image as ImageIcon,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes('Firestore Error')) {
        setHasError(true);
        setErrorDetails(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">حدث خطأ ما</h1>
          <p className="text-gray-600 mb-6">نواجه مشكلة في الاتصال بقاعدة البيانات. يرجى المحاولة مرة أخرى لاحقاً.</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-red-600 text-white py-3 rounded-xl font-semibold hover:bg-red-700 transition-colors"
          >
            إعادة تحميل الصفحة
          </button>
          {errorDetails && (
            <details className="mt-4 text-left text-xs text-gray-400">
              <summary className="cursor-pointer">تفاصيل الخطأ</summary>
              <pre className="mt-2 p-2 bg-gray-100 rounded overflow-auto max-h-40">
                {errorDetails}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'catalog' | 'admin-login'>('catalog');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const WHATSAPP_NUMBER = '201031224498';

  // Hash Listener for hidden admin route
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#selfie-admin') {
        setCurrentView('admin-login');
      } else {
        setCurrentView('catalog');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Check on mount

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Check if admin
        try {
          const userDoc = await getDocFromServer(doc(db, 'users', currentUser.uid));
          setIsAdmin(userDoc.exists() && userDoc.data()?.role === 'admin' || currentUser.email === 'ertadywomen@gmail.com');
        } catch (e) {
          // Fallback for default admin
          setIsAdmin(currentUser.email === 'ertadywomen@gmail.com');
        }
      } else {
        setIsAdmin(false);
      }
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Data Listeners
  useEffect(() => {
    const qCats = query(collection(db, 'categories'), orderBy('order', 'asc'));
    const unsubCats = onSnapshot(qCats, (snapshot) => {
      if (snapshot.empty) {
        // Bootstrap initial categories
        const initialCats = [
          { name: 'رجالي', order: 1 },
          { name: 'حريمي', order: 2 },
          { name: 'أطفالي', order: 3 },
          { name: 'أولادي', order: 4 },
          { name: 'محير/وسط', order: 5 },
          { name: 'شباشب', order: 6 },
        ];
        initialCats.forEach(cat => addDoc(collection(db, 'categories'), cat));
      }
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'categories'));

    const qProds = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    const unsubProds = onSnapshot(qProds, (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
      setIsLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'products'));

    return () => {
      unsubCats();
      unsubProds();
    };
  }, []);

  // Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  const filteredProducts = useMemo(() => {
    let result = products;
    
    if (selectedCategory !== 'all') {
      result = result.filter(p => p.categoryId === selectedCategory);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.code.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [products, selectedCategory, searchQuery]);

  const toggleProductSelection = (id: string) => {
    const newSelection = new Set(selectedProducts);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedProducts(newSelection);
  };

  const handleSingleOrder = (product: Product) => {
    const message = `مرحباً مصنع سيلفي، أريد طلب كرتونة من الموديل كود: ${product.code}، بسعر الكرتونة: ${product.totalBoxPrice} ج.م.`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleBulkOrder = () => {
    const selectedItems = products.filter(p => selectedProducts.has(p.id));
    const codes = selectedItems.map(p => p.code).join('، ');
    const message = `مرحباً مصنع سيلفي، أريد طلب الموديلات التالية: ${codes}. برجاء تأكيد التوافر.`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleDownloadImage = async (url: string, code: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `selfie-model-${code}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed', error);
      // Fallback: open in new tab
      window.open(url, '_blank');
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const uploadImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const storageRef = ref(storage, `products/${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      setIsUploading(true);
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log(`Upload progress: ${progress}%`);
          setUploadProgress(progress);
        },
        (error) => {
          console.error('Upload error details:', error);
          setIsUploading(false);
          alert(`فشل رفع الصورة: ${error.message}`);
          reject(error);
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            console.log('File available at', downloadURL);
            setIsUploading(false);
            setUploadProgress(null);
            resolve(downloadURL);
          } catch (error) {
            console.error('Error getting download URL:', error);
            setIsUploading(false);
            reject(error);
          }
        }
      );
    });
  };

  const handleSaveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const pairs = Number(formData.get('pairsPerBox'));
    const price = Number(formData.get('pricePerPair'));
    
    try {
      let imageUrl = (formData.get('imageUrl') as string) || editingProduct?.imageUrl || '';

      if (selectedFile) {
        imageUrl = await uploadImage(selectedFile);
      }

      if (!imageUrl) {
        alert('يرجى اختيار صورة للموديل');
        return;
      }

      const productData = {
        code: formData.get('code') as string,
        name: formData.get('name') as string,
        categoryId: formData.get('categoryId') as string,
        imageUrl: imageUrl,
        pairsPerBox: pairs,
        pricePerPair: price,
        totalBoxPrice: pairs * price,
        isAvailable: formData.get('isAvailable') === 'on',
        createdAt: editingProduct?.createdAt || new Date().toISOString(),
      };

      if (editingProduct) {
        await setDoc(doc(db, 'products', editingProduct.id), productData);
      } else {
        await addDoc(collection(db, 'products'), {
          ...productData,
          createdAt: serverTimestamp()
        });
      }
      setShowAdminModal(false);
      setEditingProduct(null);
      setSelectedFile(null);
      setPreviewUrl(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'products');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'products', id));
      setDeletingProductId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'products');
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col font-sans text-right" dir="rtl">
        {/* Banner */}
        <div className="bg-whatsapp text-white text-center py-2 px-4 text-sm font-medium sticky top-0 z-50 shadow-sm">
          أقل كمية للطلب هي كرتونة واحدة (مشكل مقاسات وألوان)
        </div>

        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-[36px] z-40">
          <div className="max-w-7xl mx-auto flex flex-col gap-4">
            <div className="flex items-center justify-center relative">
              <div className="flex flex-col items-center">
                <img 
                  src="https://lh3.googleusercontent.com/d/1NdyuUJOSvjzLu7MnDKeqT8R-sYvyTU9f" 
                  alt="لوجو المصنع" 
                  className="h-16 md:h-20 w-auto object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>

              <div className="absolute left-0 flex items-center gap-2">
                {isAdmin && (
                  <>
                    <button 
                      onClick={() => { setEditingProduct(null); setShowAdminModal(true); }}
                      className="p-2 bg-gray-900 text-white rounded-full hover:bg-gray-800 transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                    <button onClick={() => signOut(auth)} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                      <LogOut className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative group">
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400 group-focus-within:text-whatsapp transition-colors" />
              </div>
              <input
                type="text"
                placeholder="ابحث باسم الموديل أو الكود..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full bg-gray-50 border-none rounded-2xl py-3 pr-11 pl-4 text-sm focus:ring-2 focus:ring-whatsapp transition-all"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Categories Sticky Tabs */}
        <nav className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-[148px] z-30 px-4">
          <div className="max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar py-3">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                selectedCategory === 'all' 
                ? 'bg-gray-900 text-white shadow-lg shadow-gray-200' 
                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              الكل
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                  selectedCategory === cat.id 
                  ? 'bg-gray-900 text-white shadow-lg shadow-gray-200' 
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto w-full p-4 pb-32">
          {currentView === 'admin-login' ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100 text-center max-w-sm w-full">
                <div className="w-16 h-16 bg-gray-900 text-white rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <LogIn className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold mb-2">تسجيل دخول الإدارة</h2>
                <p className="text-gray-500 text-sm mb-8">هذه الصفحة مخصصة لمدير المصنع فقط</p>
                
                {user ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <p className="text-xs text-gray-400 mb-1">مسجل دخول كـ</p>
                      <p className="font-bold text-gray-900">{user.email}</p>
                      {!isAdmin && <p className="text-red-500 text-[10px] mt-2 font-bold">عذراً، ليس لديك صلاحيات الإدارة</p>}
                    </div>
                    <button 
                      onClick={() => { window.location.hash = ''; }}
                      className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-all"
                    >
                      العودة للمعرض
                    </button>
                    <button onClick={() => signOut(auth)} className="text-sm text-red-500 font-bold">تسجيل الخروج</button>
                  </div>
                ) : (
                  <button 
                    onClick={handleLogin}
                    className="w-full bg-whatsapp text-white py-4 rounded-2xl font-bold hover:bg-whatsapp-dark transition-all flex items-center justify-center gap-3"
                  >
                    <LogIn className="w-5 h-5" />
                    <span>تسجيل الدخول بجوجل</span>
                  </button>
                )}
              </div>
            </div>
          ) : isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl p-2 animate-pulse">
                  <div className="aspect-square bg-gray-100 rounded-xl mb-3" />
                  <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              <AnimatePresence mode="popLayout">
                {filteredProducts.map(product => (
                  <motion.div
                    layout
                    key={product.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`group relative bg-white rounded-2xl p-2 border transition-all duration-300 ${
                      selectedProducts.has(product.id) ? 'border-whatsapp ring-2 ring-whatsapp/10' : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    {/* Checkbox */}
                    <button 
                      onClick={() => toggleProductSelection(product.id)}
                      className={`absolute top-4 right-4 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all shadow-sm ${
                        selectedProducts.has(product.id) 
                        ? 'bg-whatsapp border-whatsapp text-white' 
                        : 'bg-white border-whatsapp text-transparent'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>

                    {/* Image Container */}
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-50 mb-3">
                      <img 
                        src={product.imageUrl} 
                        alt={product.name}
                        className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${!product.isAvailable ? 'grayscale opacity-50' : ''}`}
                        referrerPolicy="no-referrer"
                      />
                      {!product.isAvailable && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="bg-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">نفذت الكمية</span>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="px-1">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="text-sm font-bold text-gray-900 truncate flex-1">{product.name}</h3>
                        <span className="text-[10px] font-mono font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded ml-2">#{product.code}</span>
                      </div>
                      
                      <div className="flex flex-col gap-0.5 mb-3">
                        <div className="flex justify-between text-[11px] text-gray-400">
                          <span>التعبئة:</span>
                          <span>{product.pairsPerBox} جوز</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-400">
                          <span>سعر الجوز:</span>
                          <span>{product.pricePerPair} ج.م</span>
                        </div>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-[10px] font-bold text-gray-400">سعر الكرتونة:</span>
                          <span className="text-lg font-black text-whatsapp leading-none">{product.totalBoxPrice} <small className="text-[10px] font-bold">ج.م</small></span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleSingleOrder(product)}
                          disabled={!product.isAvailable}
                          className="flex-1 bg-whatsapp text-white py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-whatsapp-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span className="text-xs font-bold">طلب</span>
                        </button>
                        <button 
                          onClick={() => handleDownloadImage(product.imageUrl, product.code)}
                          className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>

                      {isAdmin && (
                        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-50">
                          <button 
                            onClick={() => { setEditingProduct(product); setShowAdminModal(true); }}
                            className="flex-1 flex items-center justify-center p-1.5 text-blue-500 hover:bg-blue-50 rounded"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => setDeletingProductId(product.id)}
                            className="flex-1 flex items-center justify-center p-1.5 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg font-medium">لا توجد موديلات في هذه الفئة</p>
            </div>
          )}
        </main>

        {/* Floating Action Bar */}
        <AnimatePresence>
          {selectedProducts.size > 0 && (
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-6 left-4 right-4 z-50 max-w-md mx-auto"
            >
              <div className="bg-gray-900 text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between gap-4 border border-white/10 backdrop-blur-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-whatsapp rounded-full flex items-center justify-center font-bold text-lg">
                    {selectedProducts.size}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">تم تحديد</p>
                    <p className="text-sm font-bold">موديلات للطلب</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setSelectedProducts(new Set())}
                    className="p-3 text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleBulkOrder}
                    className="bg-whatsapp hover:bg-whatsapp-dark text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all active:scale-95"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>طلب المجموعة</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Admin Modal */}
        <AnimatePresence>
          {showAdminModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowAdminModal(false)}
                className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
              >
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900">{editingProduct ? 'تعديل موديل' : 'إضافة موديل جديد'}</h2>
                  <button onClick={() => setShowAdminModal(false)} className="p-2 text-gray-400 hover:text-gray-600">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <form onSubmit={handleSaveProduct} className="p-6 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">صورة الموديل</label>
                    <div className="flex items-center gap-4">
                      <div className="w-full h-48 bg-gray-50 rounded-2xl overflow-hidden border-2 border-dashed border-gray-200 flex items-center justify-center relative group cursor-pointer hover:border-whatsapp transition-colors">
                        {previewUrl || editingProduct?.imageUrl ? (
                          <div className="relative w-full h-full">
                            <img src={previewUrl || editingProduct?.imageUrl} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <p className="text-white font-bold text-sm">تغيير الصورة</p>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center">
                            <Plus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-xs font-bold text-gray-400">انقر لرفع صورة</p>
                          </div>
                        )}
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleFileChange}
                          className="absolute inset-0 opacity-0 cursor-pointer" 
                        />
                      </div>
                    </div>
                    {isUploading && (
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase">
                          <span>جاري الرفع...</span>
                          <span>{Math.round(uploadProgress || 0)}%</span>
                        </div>
                        <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-whatsapp h-full transition-all duration-300" 
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">كود الموديل</label>
                      <input name="code" defaultValue={editingProduct?.code} required className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-whatsapp" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">اسم الموديل</label>
                      <input name="name" defaultValue={editingProduct?.name} required className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-whatsapp" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">الفئة</label>
                    <select name="categoryId" defaultValue={editingProduct?.categoryId} required className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-whatsapp">
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">رابط الصورة (اختياري في حال الرفع)</label>
                    <input 
                      name="imageUrl" 
                      placeholder="ضع رابط الصورة هنا (مثلاً من جوجل درايف)"
                      defaultValue={editingProduct?.imageUrl} 
                      className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-whatsapp" 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">عدد الأجواز</label>
                      <input type="number" name="pairsPerBox" defaultValue={editingProduct?.pairsPerBox} required className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-whatsapp" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">سعر الجوز</label>
                      <input type="number" name="pricePerPair" defaultValue={editingProduct?.pricePerPair} required className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-whatsapp" />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 py-2">
                    <input type="checkbox" name="isAvailable" defaultChecked={editingProduct ? editingProduct.isAvailable : true} className="w-5 h-5 text-whatsapp rounded focus:ring-whatsapp" />
                    <label className="text-sm font-bold text-gray-700">متوفر في المخزن</label>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isUploading}
                    className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUploading ? `جاري الرفع... ${Math.round(uploadProgress || 0)}%` : (editingProduct ? 'حفظ التغييرات' : 'إضافة الموديل')}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deletingProductId && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDeletingProductId(null)}
                className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center"
              >
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">حذف الموديل؟</h2>
                <p className="text-gray-500 text-sm mb-8">هل أنت متأكد من حذف هذا الموديل؟ لا يمكن التراجع عن هذا الإجراء.</p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setDeletingProductId(null)}
                    className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition-all"
                  >
                    إلغاء
                  </button>
                  <button 
                    onClick={() => handleDeleteProduct(deletingProductId)}
                    className="flex-1 bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 transition-all"
                  >
                    تأكيد الحذف
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
