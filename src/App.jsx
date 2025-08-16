import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, query, where, getDocs } from 'firebase/firestore';

// Define the Firebase context
const FirebaseContext = createContext(null);

// Custom hook to use Firebase services
const useFirebase = () => useContext(FirebaseContext);

// Utility function to convert Firebase Timestamp to readable string (with time)
const formatTimestamp = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate();
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

// Utility function to format date only (without time)
const formatDateOnly = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate();
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};


// Utility function to format numbers into Indian Rupees with commas
const formatRupee = (amount) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount; // Return as is if not a valid number

  // Use toLocaleString for robust Indian Rupee formatting
  // 'en-IN' locale ensures the correct comma placement (lakhs, crores)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

// Utility function to format mobile number for WhatsApp
const getFormattedMobileForWhatsApp = (mobile) => {
  if (!mobile) return '';
  // Remove any non-digit characters from the mobile number
  const cleanedMobile = mobile.replace(/\D/g, '');

  // Check if it already starts with a country code (e.g., +91 or 91)
  if (cleanedMobile.startsWith('91') && cleanedMobile.length >= 10) {
    // If it starts with '91' and is at least 10 digits (common for Indian numbers without +)
    return `+${cleanedMobile}`;
  } else {
    // Assume it's a 10-digit Indian number and prepend +91
    return `+91${cleanedMobile}`;
  }
};


// Loading Indicator Component
const LoadingIndicator = ({ message = "Loading..." }) => (
  <div className="flex justify-center items-center h-screen bg-gray-100">
    <div className="flex flex-col items-center p-6 bg-white rounded-lg shadow-xl">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      <p className="mt-4 text-lg text-gray-700">{message}</p>
    </div>
  </div>
);

// Message Box Component (replaces alert/confirm)
const MessageBox = ({ message, type = 'info', onClose, onConfirm }) => {
  const bgColor = type === 'error' ? 'bg-red-500' : type === 'success' ? 'bg-green-500' : 'bg-blue-500';
  const buttonColor = type === 'error' ? 'bg-red-700 hover:bg-red-800' : type === 'success' ? 'bg-green-700 hover:bg-green-800' : 'bg-blue-700 hover:bg-blue-800';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
        <div className={`p-3 rounded-t-lg text-white ${bgColor} flex justify-between items-center`}>
          <h3 className="font-semibold text-lg">{type.charAt(0).toUpperCase() + type.slice(1)}</h3>
          <button onClick={onClose} className="text-white hover:text-gray-200">
            &times;
          </button>
        </div>
        <div className="p-4">
          <p className="text-gray-700 mb-4">{message}</p>
          <div className="flex justify-end space-x-2">
            {onConfirm && (
              <button
                onClick={onConfirm}
                className={`py-2 px-4 rounded-md text-white font-medium ${buttonColor} focus:outline-none focus:ring-2 focus:ring-offset-2`}
              >
                Confirm
              </button>
            )}
            <button
              onClick={onClose}
              className="py-2 px-4 rounded-md bg-gray-300 text-gray-800 font-medium hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              {onConfirm ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// Main App component
function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  // 'dashboard', 'customerDetail', 'addCustomer', 'transactionForm' (for both add/edit)
  const [view, setView] = useState('dashboard');
  const [selectedCustomerSupplier, setSelectedCustomerSupplier] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null); // State to hold the transaction being edited
  const [messageBox, setMessageBox] = useState(null); // { message: '', type: '', onConfirm: null }

  // Initialize Firebase and handle authentication
  useEffect(() => {
    const initializeFirebase = async () => {
      try {
        const appId = import.meta.env.VITE_APP_ID || 'default-app-id';
        const firebaseConfig = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG || '{}');
        // Ensure firebaseConfig is not empty before initializing
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase config is missing. Cannot initialize Firebase.");
            setMessageBox({
              message: "Firebase configuration is missing. Please ensure the app is run in a valid environment.",
              type: "error",
              onClose: () => setLoading(false)
            });
            return;
        }

        const firebaseApp = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(firebaseApp);
        const firebaseAuth = getAuth(firebaseApp);

        setDb(firestoreDb);
        setAuth(firebaseAuth);

        // Sign in with custom token or anonymously if token is not available
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(firebaseAuth, __initial_auth_token);
        } else {
          await signInAnonymously(firebaseAuth);
        }

        // Listen for auth state changes to get the user ID
        const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
          if (user) {
            setUserId(user.uid);
            console.log('Firebase user ID:', user.uid);
            setLoading(false); // Auth is ready, stop loading
          } else {
            setUserId(null);
            console.log('No Firebase user signed in.');
            setLoading(false); // Auth is ready, stop loading
          }
        });

        return () => unsubscribe(); // Cleanup auth listener on unmount
      } catch (error) {
        console.error("Error initializing Firebase:", error);
        setMessageBox({
          message: `Failed to initialize Firebase: ${error.message}. Please check your environment.`,
          type: "error",
          onClose: () => setLoading(false)
        });
      }
    };

    initializeFirebase();
  }, []);

  const showMessageBox = (message, type = 'info', onConfirm = null) => {
    setMessageBox({ message, type, onConfirm, onClose: () => setMessageBox(null) });
  };

  // Function to handle navigation to transaction form for adding
  const handleAddTransaction = () => {
    setEditingTransaction(null); // Ensure no transaction is being edited
    setView('transactionForm');
  };

  // Function to handle navigation to transaction form for editing
  const handleEditTransaction = (transaction) => {
    setEditingTransaction(transaction); // Set the transaction to be edited
    setView('transactionForm');
  };


  if (loading) {
    return <LoadingIndicator message="Connecting to services..." />;
  }

  return (
    <FirebaseContext.Provider value={{ db, auth, userId, showMessageBox }}>
      <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4 font-inter">
        <header className="w-full max-w-4xl bg-gradient-to-r from-purple-600 to-indigo-700 text-white p-6 rounded-xl shadow-lg mb-6 flex flex-col sm:flex-row justify-between items-center">
          <h1 className="text-3xl font-bold mb-2 sm:mb-0">OKCREDIT Clone</h1>
          {userId && (
            <div className="text-sm bg-purple-700 p-2 rounded-md shadow-inner">
              User ID: <span className="font-mono break-all">{userId}</span>
            </div>
          )}
        </header>

        {/* Navigation Bar */}
        <nav className="w-full max-w-4xl bg-white p-4 rounded-xl shadow-lg mb-6 flex justify-around items-center space-x-4">
          <button
            onClick={() => { setView('dashboard'); setSelectedCustomerSupplier(null); setEditingTransaction(null); }}
            className={`py-2 px-4 rounded-md font-semibold transition duration-200 ease-in-out ${
              view === 'dashboard' ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Dashboard
          </button>
          {view !== 'dashboard' && (
            <button
              onClick={() => {
                if (view === 'customerDetail' || (view === 'transactionForm' && !editingTransaction)) {
                  // If currently on customerDetail or adding new transaction, go back to dashboard
                  setView('dashboard');
                  setSelectedCustomerSupplier(null);
                  setEditingTransaction(null);
                } else if (view === 'transactionForm' && editingTransaction) {
                  // If currently editing a transaction, go back to customer detail
                  setView('customerDetail');
                  setEditingTransaction(null);
                }
              }}
              className="py-2 px-4 rounded-md bg-gray-200 text-gray-700 font-semibold hover:bg-gray-300 transition duration-200 ease-in-out"
            >
              Back
            </button>
          )}
        </nav>

        <main className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-6">
          {view === 'dashboard' && (
            <Dashboard
              onSelectCustomerSupplier={(cs) => {
                setSelectedCustomerSupplier(cs);
                setView('customerDetail');
              }}
              onAddCustomer={() => setView('addCustomer')}
            />
          )}
          {view === 'customerDetail' && selectedCustomerSupplier && (
            <CustomerDetail
              customerSupplier={selectedCustomerSupplier}
              onBack={() => {
                setSelectedCustomerSupplier(null);
                setView('dashboard');
              }}
              onAddTransaction={handleAddTransaction} // Use the new handler
              onEditTransaction={handleEditTransaction} // New prop for editing
            />
          )}
          {view === 'addCustomer' && (
            <AddCustomer
              onSave={() => setView('dashboard')}
              onCancel={() => setView('dashboard')}
            />
          )}
          {(view === 'transactionForm' && selectedCustomerSupplier) && (
            <TransactionForm
              customerSupplierId={selectedCustomerSupplier.id}
              customerSupplierName={selectedCustomerSupplier.name}
              initialTransaction={editingTransaction} // Pass the transaction being edited
              onSave={() => {
                setView('customerDetail');
                setEditingTransaction(null); // Clear editing state after save
              }}
              onCancel={() => {
                setView('customerDetail');
                setEditingTransaction(null); // Clear editing state after cancel
              }}
            />
          )}
        </main>

        {messageBox && (
          <MessageBox
            message={messageBox.message}
            type={messageBox.type}
            onClose={messageBox.onClose}
            onConfirm={messageBox.onConfirm}
          />
        )}
      </div>
    </FirebaseContext.Provider>
  );
}

// Dashboard Component
const Dashboard = ({ onSelectCustomerSupplier, onAddCustomer }) => {
  const { db, userId, showMessageBox } = useFirebase();
  const [customersSuppliers, setCustomersSuppliers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  // Removed filterType state as 'all' and 'customer' filters are no longer needed
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!db || !userId) return;

    setLoadingCustomers(true);
    // Query only for 'customer' type contacts
    const q = query(
      collection(db, `artifacts/${appId}/users/${userId}/customers_suppliers`),
      where("type", "==", "customer") // Filter to only show customers
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const csList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCustomersSuppliers(csList);
      setLoadingCustomers(false);
    }, (error) => {
      console.error("Error fetching customers/suppliers: ", error);
      showMessageBox(`Failed to load contacts: ${error.message}`, 'error');
      setLoadingCustomers(false);
    });

    return () => unsubscribe();
  }, [db, userId, showMessageBox]);

  const filteredContacts = customersSuppliers.filter(cs => {
    // No type filtering needed as the query already filters for 'customer'
    const lowerCaseQuery = searchQuery.toLowerCase();
    const matchesSearch =
      cs.name.toLowerCase().includes(lowerCaseQuery) ||
      (cs.mobile && cs.mobile.includes(lowerCaseQuery)) ||
      (cs.address && cs.address.toLowerCase().includes(lowerCaseQuery));
    return matchesSearch;
  });

  if (loadingCustomers) {
    return <LoadingIndicator message="Loading customers..." />;
  }

  return (
    <div className="p-4">
      {/* Search Bar at the top */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by name, mobile, or address..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="p-3 border border-gray-300 rounded-lg w-full focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition duration-200 ease-in-out"
        />
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Your Customers</h2>
        <button
          onClick={onAddCustomer}
          className="py-2 px-4 bg-green-500 text-white font-bold rounded-lg shadow-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out"
        >
          + Add Customer
        </button>
      </div>


      {/* Removed filter buttons */}
      {filteredContacts.length === 0 ? (
        <p className="text-center text-gray-600 text-lg mt-8">No customers found. Add a new customer to get started!</p>
      ) : (
        <div className="space-y-3">
          {filteredContacts.map((cs) => (
            <div
              key={cs.id}
              onClick={() => onSelectCustomerSupplier(cs)}
              className="bg-white p-4 rounded-lg shadow-sm hover:shadow-md transition duration-200 ease-in-out cursor-pointer flex items-center space-x-4 border border-gray-200"
            >
              {/* Avatar/Initial */}
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xl">
                {cs.name ? cs.name.charAt(0).toUpperCase() : '?'}
              </div>

              {/* Contact Info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 truncate">{cs.name}</h3>
                <p className={`text-sm font-medium text-blue-600 truncate`}>
                  Customer
                  {cs.mobile && ` • ${cs.mobile}`}
                </p>
                {cs.address && <p className="text-gray-600 text-sm truncate mt-0.5">Address: {cs.address}</p>}
              </div>

              {/* Balance/Last Message Indicator */}
              <div className="flex-shrink-0 text-right">
                <span className={`text-md font-bold ${
                  cs.balance > 0 ? 'text-red-600' : (cs.balance < 0 ? 'text-green-600' : 'text-gray-600')
                }`}>
                  {formatRupee(Math.abs(cs.balance || 0))}
                </span>
                <p className={`text-xs ${
                  cs.balance > 0 ? 'text-red-500' : (cs.balance < 0 ? 'text-green-500' : 'text-gray-500')
                }`}>
                  {cs.balance > 0 ? 'They Owe You' : (cs.balance < 0 ? 'You Owe' : 'Settled')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Customer Detail Component
const CustomerDetail = ({ customerSupplier, onBack, onAddTransaction, onEditTransaction }) => {
  const { db, userId, showMessageBox } = useFirebase();
  const [transactions, setTransactions] = useState([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [balance, setBalance] = useState(customerSupplier.balance || 0);
  const [showWhatsappOptions, setShowWhatsappOptions] = useState(false); // State for dropdown visibility

  useEffect(() => {
    if (!db || !userId || !customerSupplier?.id) return;

    setLoadingTransactions(true);
    const q = query(
      collection(db, `artifacts/${appId}/users/${userId}/transactions`),
      where("customerSupplierId", "==", customerSupplier.id)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      let fetchedTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Sort transactions by date in descending order after fetching them
      fetchedTransactions.sort((a, b) => {
        const dateA = a.date ? a.date.toMillis() : 0;
        const dateB = b.date ? b.date.toMillis() : 0;
        return dateB - dateA;
      });

      setTransactions(fetchedTransactions);

      // Recalculate balance locally from transactions for accuracy
      let currentBalance = 0;
      fetchedTransactions.forEach(t => {
        if (t.type === 'credit') { // 'credit' is now 'नाम' (You Gave)
          currentBalance += t.amount;
        } else if (t.type === 'debit') { // 'debit' is now 'जमा' (You Got)
          currentBalance -= t.amount;
        }
      });
      setBalance(currentBalance);

      // Optionally update the customer/supplier document's balance field in Firestore
      // This is good for quick lookups on the dashboard, but the source of truth is the transactions.
      try {
        const csRef = doc(db, `artifacts/${appId}/users/${userId}/customers_suppliers`, customerSupplier.id);
        await updateDoc(csRef, { balance: currentBalance });
      } catch (error) {
        console.error("Error updating customer/supplier balance:", error);
        // Do not show a message box for this background update to avoid user annoyance
      }

      setLoadingTransactions(false);
    }, (error) => {
      console.error("Error fetching transactions: ", error);
      showMessageBox(`Failed to load transactions: ${error.message}`, 'error');
      setLoadingTransactions(false);
    });

    return () => unsubscribe();
  }, [db, userId, customerSupplier.id, showMessageBox]);

  const handleDeleteTransaction = (transactionId) => {
    showMessageBox(
      "Are you sure you want to delete this transaction? This action cannot be undone.",
      "error",
      async () => {
        try {
          // No need to manually adjust balance here; the onSnapshot listener will re-calculate
          await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/transactions`, transactionId));
          showMessageBox("Transaction deleted successfully!", "success");
        } catch (error) {
          console.error("Error deleting transaction:", error);
          showMessageBox(`Failed to delete transaction: ${error.message}`, "error");
        }
      }
    );
  };

  // Function to generate WhatsApp message for overall balance
  const handleSendBalanceReminder = () => {
    let message = `Hello ${customerSupplier.name},\n\n`;
    if (balance > 0) {
      // If they owe you (positive balance)
      message += `*Your current balance is ${formatRupee(balance)} (बाकी).*`;
    } else if (balance < 0) {
      // If you owe them (negative balance)
      message += `*Your current balance is ${formatRupee(Math.abs(balance))} (जमा).*`;
    } else {
      // Balance is zero
      message += `*Your account balance is settled. Thank you!*`;
    }
    message += `\n\nFrom,\nGajanand Jewelers\nAjeetgarh, Sikar`; // Updated business name and address

    const formattedMobile = getFormattedMobileForWhatsApp(customerSupplier.mobile);
    const whatsappUrl = `https://wa.me/${formattedMobile}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    setShowWhatsappOptions(false); // Close options after clicking
  };

  // Function to generate WhatsApp message for detailed transactions
  const handleSendDetailedTransactions = () => {
    let message = `Hello ${customerSupplier.name},\n\nHere are your transaction details:\n\n`;

    if (transactions.length === 0) {
      message += "No transactions recorded yet.";
    } else {
      transactions.forEach(tx => {
        const typeEmoji = tx.type === 'credit' ? '🔴' : '🟢'; // Red for 'नाम', Green for 'जमा'
        const typeLabel = tx.type === 'credit' ? 'नाम (You Gave)' : 'जमा (You Got)';
        message += `- ${formatDateOnly(tx.date)}: ${typeLabel} ${typeEmoji} *${formatRupee(tx.amount)}*`; // Date only, emoji, bold amount
        if (tx.description) {
          message += ` (${tx.description})`;
        }
        message += '\n';
      });
      message += `\n\n*Your current balance is ${formatRupee(Math.abs(balance))} ${balance > 0 ? '(बाकी)' : (balance < 0 ? '(जमा)' : '(Settled)')}.*`; // Bold balance line
    }
    message += `\n\nFrom,\nGajanand Jewelers\nAjeetgarh, Sikar`; // Updated business name and address

    const formattedMobile = getFormattedMobileForWhatsApp(customerSupplier.mobile);
    const whatsappUrl = `https://wa.me/${formattedMobile}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    setShowWhatsappOptions(false); // Close options after clicking
  };

  if (loadingTransactions) {
    return <LoadingIndicator message="Loading transactions..." />;
  }

  // Determine the balance box background and text color based on the balance
  const balanceBoxBgColor = balance === 0
    ? 'bg-gray-100 border-gray-300'
    : 'bg-red-100 border-red-400'; // Any non-zero balance is red

  const balanceTextColor = balance === 0
    ? 'text-gray-700'
    : 'text-red-700'; // Any non-zero balance text is red

  // Determine the balance label
  const balanceLabel = balance === 0
    ? '(Settled)'
    : (balance > 0 ? 'बाकी' : 'जमा'); // 'बाकी' if they owe you, 'जमा' if you owe them


  return (
    <div className="p-4 relative"> {/* Added relative for positioning dropdown */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={onBack}
          className="py-2 px-4 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 flex items-center shadow-sm hover:shadow-md transition duration-200 ease-in-out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Back to Dashboard
        </button>

        {/* WhatsApp Button and Dropdown */}
        {customerSupplier.mobile && (
          <div className="relative">
            <button
              onClick={() => setShowWhatsappOptions(!showWhatsappOptions)}
              className="py-2 px-4 bg-green-500 text-white font-bold rounded-lg shadow-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
              Send WhatsApp
            </button>
            {showWhatsappOptions && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 z-10">
                <button
                  onClick={handleSendBalanceReminder}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                >
                  Send Balance Reminder
                </button>
                <button
                  onClick={handleSendDetailedTransactions}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                >
                  Send Detailed Transactions
                </button>
              </div>
            )}
          </div>
        )}
      </div>


      <h2 className="text-3xl font-bold mb-4 text-gray-900">{customerSupplier.name}</h2>
      <p className={`text-lg font-medium mb-4 text-blue-600`}>
        Customer
      </p>
      {customerSupplier.mobile && <p className="text-gray-600 text-base mb-1">Mobile: {customerSupplier.mobile}</p>}
      {customerSupplier.address && <p className="text-gray-600 text-base mb-4">Address: {customerSupplier.address}</p>}


      <div className={`p-5 rounded-xl shadow-lg mb-6 flex justify-between items-center ${balanceBoxBgColor} border-2`}>
        <div>
          <span className="text-xl font-semibold text-gray-700">Current Balance:</span>
          <span className={`ml-3 text-3xl font-extrabold ${balanceTextColor}`}>
            {formatRupee(Math.abs(balance))}
          </span>
        </div>
        <div className="text-right">
          <span className={`${balanceTextColor} font-bold text-xl`}>{balanceLabel}</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 mb-6">
        <button
          onClick={onAddTransaction}
          className="flex-1 py-3 px-6 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 ease-in-out"
        >
          + Add Transaction
        </button>
        {/* Removed old Send Reminder button */}
      </div>

      <h3 className="text-2xl font-bold mb-4 text-gray-800">Transaction History</h3>
      {transactions.length === 0 ? (
        <p className="text-center text-gray-600 text-lg mt-8">No transactions yet. Add a new transaction!</p>
      ) : (
        <div className="space-y-4">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className={`flex ${tx.type === 'credit' ? 'justify-start' : 'justify-end'}`} // 'credit' (नाम) on left, 'debit' (जमा) on right
            >
              <div
                className={`p-4 rounded-xl shadow-md max-w-xs sm:max-w-md w-full ${
                  tx.type === 'credit' // 'credit' (नाम) - left, red
                    ? 'bg-red-500 text-white rounded-br-none'
                    : 'bg-green-500 text-white rounded-bl-none' // 'debit' (जमा) - right, green
                }`}
              >
                <p className="text-lg font-semibold">
                  {tx.type === 'credit' ? 'नाम (You Gave)' : 'जमा (You Got)'}
                </p>
                <p className="text-xl font-bold mt-1">
                  {formatRupee(tx.amount)}
                </p>
                {tx.description && <p className="text-sm mt-2 opacity-90">{tx.description}</p>}
                <div className="flex justify-between items-center text-xs mt-2 opacity-80">
                  <span>{formatTimestamp(tx.date)}</span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onEditTransaction(tx)}
                      className="p-1 text-white hover:text-gray-200 rounded-full hover:bg-opacity-20 transition duration-200 ease-in-out"
                      aria-label="Edit transaction"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L15.232 5.232z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteTransaction(tx.id)}
                      className="p-1 text-white hover:text-gray-200 rounded-full hover:bg-opacity-20 transition duration-200 ease-in-out"
                      aria-label="Delete transaction"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Add Customer Component
const AddCustomer = ({ onSave, onCancel }) => {
  const { db, userId, showMessageBox } = useFirebase();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      showMessageBox("Name cannot be empty.", "error");
      return;
    }
    if (!db || !userId) {
      showMessageBox("Firebase not initialized. Please try again.", "error");
      return;
    }

    setLoading(true);
    try {
      // Always add as 'customer'
      await addDoc(collection(db, `artifacts/${appId}/users/${userId}/customers_suppliers`), {
        name: name.trim(),
        mobile: mobile.trim(),
        address: address.trim(),
        type: 'customer', // Fixed to customer
        balance: 0, // Initial balance is 0
        createdAt: new Date(),
      });
      showMessageBox(`${name} added successfully as a customer!`, "success");
      onSave(); // Go back to dashboard or customer list
    } catch (error) {
      console.error("Error adding customer:", error);
      showMessageBox(`Failed to add contact: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Add New Customer</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="name" className="block text-gray-700 text-sm font-bold mb-2">
            Name:
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Enter customer name"
            required
          />
        </div>
        <div>
          <label htmlFor="mobile" className="block text-gray-700 text-sm font-bold mb-2">
            Mobile Number (Optional):
          </label>
          <input
            type="tel" // Use type="tel" for mobile numbers
            id="mobile"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="e.g., +919876543210"
          />
        </div>
        <div>
          <label htmlFor="address" className="block text-gray-700 text-sm font-bold mb-2">
            Address (Optional):
          </label>
          <textarea
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows="2"
            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Enter customer address"
          ></textarea>
        </div>
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={onCancel}
            className="py-3 px-6 bg-gray-300 text-gray-800 font-bold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200 ease-in-out"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="py-3 px-6 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 ease-in-out"
            disabled={loading}
          >
            {loading ? 'Adding...' : 'Add Customer'}
          </button>
        </div>
      </form>
    </div>
  );
};

// TransactionForm Component (formerly AddTransaction)
const TransactionForm = ({ customerSupplierId, customerSupplierName, initialTransaction, onSave, onCancel }) => {
  const { db, userId, showMessageBox } = useFirebase();

  // State for the raw numeric amount, and for the displayed (formatted) amount string
  const [rawAmount, setRawAmount] = useState(() => initialTransaction ? initialTransaction.amount : '');
  const [displayAmount, setDisplayAmount] = useState(() => initialTransaction ? formatRupee(initialTransaction.amount) : '');


  const [type, setType] = useState(() => initialTransaction ? initialTransaction.type : 'credit'); // 'debit' for जमा, 'credit' for नाम
  const [description, setDescription] = useState(() => initialTransaction ? initialTransaction.description : '');
  // Initialize date state with initial transaction date or today's date
  const [date, setDate] = useState(() => {
    if (initialTransaction && initialTransaction.date) {
      // Convert Firestore Timestamp to Date object, then to YYYY-MM-DD string
      return initialTransaction.date.toDate().toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  });
  const [loading, setLoading] = useState(false);

  // Determine if we are in edit mode
  const isEditing = !!initialTransaction;
  const formTitle = isEditing ? `Edit Transaction for ${customerSupplierName}` : `Add Transaction for ${customerSupplierName}`;
  const submitButtonText = isEditing ? 'Save Changes' : 'Save Transaction';

  // Handle change for the amount input
  const handleAmountChange = (e) => {
    let value = e.target.value;

    // Remove any non-digit characters except for a single decimal point.
    // This allows typing numbers and a decimal.
    const cleanedValue = value.replace(/[^0-9.]/g, '');

    // Allow empty string if user clears the input
    if (cleanedValue === '') {
      setRawAmount('');
      setDisplayAmount('');
      return;
    }

    // Attempt to parse the cleaned value to a float
    const parsedValue = parseFloat(cleanedValue);

    // If it's a valid number, store the raw amount and update display with the partially formatted string.
    // This prevents cursor jumping while typing.
    if (!isNaN(parsedValue) && cleanedValue.match(/^\d*\.?\d*$/)) { // Ensures only valid number formats
      setRawAmount(parsedValue);
      // Keep display as cleanedValue during typing to allow full control of input
      setDisplayAmount(cleanedValue);
    } else {
      // If not a valid number, keep display as is (e.g., if user types multiple decimals)
      setDisplayAmount(cleanedValue);
      setRawAmount('');
    }
  };

  // Handle blur for the amount input to ensure final formatting
  const handleAmountBlur = () => {
    if (rawAmount !== '' && !isNaN(rawAmount)) {
      setDisplayAmount(formatRupee(rawAmount)); // Apply full formatting on blur
    } else {
      setDisplayAmount(''); // Clear display if raw amount is invalid/empty
    }
  };


  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsedAmount = parseFloat(rawAmount); // Use rawAmount for submission

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showMessageBox("Please enter a valid positive amount.", "error");
      return;
    }
    if (!db || !userId) {
      showMessageBox("Firebase not initialized. Please try again.", "error");
      return;
    }

    setLoading(true);
    try {
      // Convert the date string from the input to a Date object
      const transactionDate = new Date(date);

      const transactionData = {
        customerSupplierId: customerSupplierId,
        amount: parsedAmount,
        type: type, // 'debit' for जमा, 'credit' for नाम
        description: description.trim(),
        date: transactionDate,
        updatedAt: new Date(), // Add updatedAt for tracking edits
      };

      if (isEditing) {
        // Update existing transaction
        await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/transactions`, initialTransaction.id), transactionData);
        showMessageBox("Transaction updated successfully!", "success");
      } else {
        // Add new transaction
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/transactions`), {
          ...transactionData,
          createdAt: new Date(), // createdAt only for new transactions
        });
        showMessageBox(`Transaction recorded successfully for ${customerSupplierName}!`, "success");
      }
      onSave(); // Go back to customer detail
    } catch (error) {
      console.error("Error saving transaction:", error);
      showMessageBox(`Failed to save transaction: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">{formTitle}</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="amount" className="block text-gray-700 text-sm font-bold mb-2">
            Amount:
          </label>
          <input
            type="text" // Changed to text to allow formatting
            id="amount"
            value={displayAmount} // Display the formatted string
            onChange={handleAmountChange}
            onBlur={handleAmountBlur} // Apply final format on blur
            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Enter amount (e.g., ₹ 500.00)" // Updated placeholder
            required
          />
        </div>
        {/* Date selection field */}
        <div>
          <label htmlFor="date" className="block text-gray-700 text-sm font-bold mb-2">
            Date:
          </label>
          <input
            type="date"
            id="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            required
          />
        </div>
        <div>
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Transaction Type:
          </label>
          {/* Changed layout for radio buttons to match left/right visual of transactions */}
          <div className="flex justify-between p-3 border border-gray-200 rounded-lg bg-gray-50">
            <label className="inline-flex items-center p-2 rounded-md hover:bg-white transition-colors duration-200 ease-in-out cursor-pointer">
              <input
                type="radio"
                className="form-radio h-5 w-5 text-red-600" // Red for 'You Gave' / नाम
                name="transactionType"
                value="credit" // 'credit' is for 'नाम' (You Gave)
                checked={type === 'credit'}
                onChange={() => setType('credit')}
              />
              <span className="ml-2 text-red-700 font-semibold">नाम (You Gave)</span>
            </label>
            <label className="inline-flex items-center p-2 rounded-md hover:bg-white transition-colors duration-200 ease-in-out cursor-pointer">
              <input
                type="radio"
                className="form-radio h-5 w-5 text-green-600" // Green for 'You Got' / जमा
                name="transactionType"
                value="debit" // 'debit' is for 'जमा' (You Got)
                checked={type === 'debit'}
                onChange={() => setType('debit')}
              />
              <span className="ml-2 text-green-700 font-semibold">जमा (You Got)</span>
            </label>
          </div>
        </div>
        <div>
          <label htmlFor="description" className="block text-gray-700 text-sm font-bold mb-2">
            Description (Optional):
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows="3"
            className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Add a short description (e.g., 'Groceries', 'Payment received')"
          ></textarea>
        </div>
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={onCancel}
            className="py-3 px-6 bg-gray-300 text-gray-800 font-bold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200 ease-in-out"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="py-3 px-6 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 ease-in-out"
            disabled={loading}
          >
            {loading ? (isEditing ? 'Saving Changes...' : 'Saving Transaction...') : submitButtonText}
          </button>
        </div>
      </form>
    </div>
  );
};

// Export the main App component as default
export default App;
