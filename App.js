import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Modal,
  Animated,
  Linking,
} from "react-native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { generateEmailDraft, reviseEmailDraft } from "./gemini";

// Color palette
const C = {
  bg: "#F7F8FC",
  card: "#FFFFFF",
  primary: "#4A6CF7",
  primaryDark: "#3451DB",
  primaryLight: "#EEF1FE",
  accent: "#10B981",
  accentLight: "#ECFDF5",
  text: "#1E293B",
  textSecondary: "#64748B",
  textLight: "#94A3B8",
  border: "#E2E8F0",
  error: "#EF4444",
  white: "#FFFFFF",
  overlay: "rgba(0,0,0,0.5)",
};

// ═══════════════════════════════════════════════════════════════
//  REPORT SCREEN
// ═══════════════════════════════════════════════════════════════
function ReportScreen({ onSubmit }) {
  const [description, setDescription] = useState("");
  const [useLocation, setUseLocation] = useState(false);
  const [location, setLocation] = useState(null);
  const [locationText, setLocationText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(false);

  useEffect(() => {
    if (!useLocation) {
      setLocation(null);
      setLocationText("");
      return;
    }
    (async () => {
      setLoadingLocation(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Denied", "Location permission is required to auto-detect your location.");
          setUseLocation(false);
          setLoadingLocation(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (geo) {
          const parts = [geo.streetNumber, geo.street, geo.city, geo.region].filter(Boolean);
          setLocationText(parts.join(", "));
        } else {
          setLocationText(`${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`);
        }
      } catch (e) {
        Alert.alert("Location Error", e.message);
        setUseLocation(false);
      }
      setLoadingLocation(false);
    })();
  }, [useLocation]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "We need access to your photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "We need access to your camera.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  const handleSubmit = () => {
    if (!description.trim()) {
      Alert.alert("Missing Description", "Please describe the issue you'd like to report.");
      return;
    }
    onSubmit({ description: description.trim(), location, photo });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Report an Issue</Text>
        <Text style={styles.headerSubtitle}>Describe the problem and we'll route it to the right department</Text>
      </View>

      {/* Description */}
      <View style={styles.card}>
        <Text style={styles.label}>What's the issue?</Text>
        <TextInput
          style={styles.textArea}
          placeholder={'e.g. "There\'s a pothole on University Ave outside the pizza shop"'}
          placeholderTextColor={C.textLight}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          value={description}
          onChangeText={setDescription}
        />
      </View>

      {/* Location */}
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Text style={{ fontSize: 18 }}>📍</Text>
            <Text style={styles.labelInline}>Use my location</Text>
          </View>
          <Switch
            value={useLocation}
            onValueChange={setUseLocation}
            trackColor={{ false: C.border, true: C.primaryLight }}
            thumbColor={useLocation ? C.primary : "#f4f4f5"}
          />
        </View>
        {loadingLocation && (
          <View style={styles.locationLoading}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={styles.locationLoadingText}>Detecting location...</Text>
          </View>
        )}
        {locationText ? (
          <View style={styles.locationBadge}>
            <Text style={styles.locationBadgeText}>{locationText}</Text>
          </View>
        ) : null}
      </View>

      {/* Photo */}
      <View style={styles.card}>
        <Text style={styles.label}>Add a photo (optional)</Text>
        <View style={styles.photoButtons}>
          <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
            <Text style={{ fontSize: 18 }}>📷</Text>
            <Text style={styles.photoBtnText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoBtn} onPress={pickImage}>
            <Text style={{ fontSize: 18 }}>🖼️</Text>
            <Text style={styles.photoBtnText}>Choose Photo</Text>
          </TouchableOpacity>
        </View>
        {photo && (
          <View style={styles.photoPreviewContainer}>
            <Image source={{ uri: photo }} style={styles.photoPreview} />
            <TouchableOpacity style={styles.removePhoto} onPress={() => setPhoto(null)}>
              <Text style={styles.removePhotoText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitBtn, !description.trim() && styles.btnDisabled]}
        onPress={handleSubmit}
        activeOpacity={0.8}
      >
        <Text style={{ fontSize: 18 }}>✨</Text>
        <Text style={styles.submitBtnText}>Find Department & Draft Email</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════
//  LOADING SCREEN
// ═══════════════════════════════════════════════════════════════
function LoadingScreen() {
  return (
    <View style={styles.centerScreen}>
      <ActivityIndicator size="large" color={C.primary} />
      <Text style={styles.loadingTitle}>Routing your report...</Text>
      <Text style={styles.loadingSubtitle}>Finding the right department and drafting an email</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
//  EMAIL REVIEW SCREEN
// ═══════════════════════════════════════════════════════════════
function EmailScreen({ email, onRevise, onSend, onBack, revising }) {
  const [editMode, setEditMode] = useState(false);
  const [to, setTo] = useState(email.to);
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [suggestion, setSuggestion] = useState("");
  const [showSuggestionBox, setShowSuggestionBox] = useState(false);

  const useWebsiteInstead = email.useWebsiteInstead;
  const websiteUrl = email.websiteUrl;

  useEffect(() => {
    setTo(email.to);
    setSubject(email.subject);
    setBody(email.body);
    setEditMode(false);
    setShowSuggestionBox(false);
    setSuggestion("");
  }, [email]);

  const handleSuggest = () => {
    if (!suggestion.trim()) return;
    onRevise({
      currentTo: to,
      currentSubject: subject,
      currentBody: body,
      suggestion: suggestion.trim(),
    });
  };

  const openWebsite = () => {
    if (websiteUrl) {
      Linking.openURL(websiteUrl).catch(() => {
        Alert.alert("Error", "Could not open website");
      });
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.emailHeader}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← New Report</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{useWebsiteInstead ? "Contact Information" : "Review Email"}</Text>
          <Text style={styles.headerSubtitle}>
            {useWebsiteInstead
              ? "We couldn't verify a direct email. Please use the official website to submit your report."
              : "We found the right contact. Review the draft below."}
          </Text>
        </View>

        {/* Website Notice */}
        {useWebsiteInstead && (
          <View style={styles.websiteNotice}>
            <Text style={styles.websiteNoticeIcon}>🌐</Text>
            <Text style={styles.websiteNoticeText}>
              To ensure your report reaches the right department, please submit through the official city website.
            </Text>
            <TouchableOpacity style={styles.websiteBtn} onPress={openWebsite}>
              <Text style={styles.websiteBtnText}>Open Official Website</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Email Card */}
        <View style={styles.emailCard}>
          {/* To */}
          <View style={styles.emailField}>
            <Text style={styles.emailFieldLabel}>To</Text>
            {editMode ? (
              <TextInput style={styles.emailFieldInput} value={to} onChangeText={setTo} autoCapitalize="none" keyboardType="email-address" />
            ) : (
              <Text style={styles.emailFieldValue}>{to}</Text>
            )}
          </View>
          <View style={styles.emailDivider} />

          {/* Subject */}
          <View style={styles.emailField}>
            <Text style={styles.emailFieldLabel}>Subject</Text>
            {editMode ? (
              <TextInput style={styles.emailFieldInput} value={subject} onChangeText={setSubject} />
            ) : (
              <Text style={styles.emailFieldValue}>{subject}</Text>
            )}
          </View>
          <View style={styles.emailDivider} />

          {/* Body */}
          <View style={styles.emailBodySection}>
            {editMode ? (
              <TextInput
                style={styles.emailBodyInput}
                value={body}
                onChangeText={setBody}
                multiline
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.emailBodyText}>{body}</Text>
            )}
          </View>
        </View>

        {/* Action Row */}
        <View style={styles.emailActions}>
          <TouchableOpacity style={styles.editBtn} onPress={() => setEditMode(!editMode)}>
            <Text style={{ fontSize: 15 }}>✏️</Text>
            <Text style={styles.editBtnText}>{editMode ? "Done Editing" : "Edit Manually"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.suggestBtn} onPress={() => setShowSuggestionBox(!showSuggestionBox)}>
            <Text style={{ fontSize: 15 }}>✨</Text>
            <Text style={styles.suggestBtnText}>{showSuggestionBox ? "Hide" : "Suggest a Change"}</Text>
          </TouchableOpacity>
        </View>

        {/* AI Suggestion */}
        {showSuggestionBox && (
          <View style={styles.suggestionCard}>
            <Text style={styles.suggestionLabel}>What would you like to change?</Text>
            <TextInput
              style={styles.suggestionInput}
              placeholder='e.g. "Make it more urgent" or "Add that this has been ongoing for 2 weeks"'
              placeholderTextColor={C.textLight}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={suggestion}
              onChangeText={setSuggestion}
            />
            <TouchableOpacity
              style={[styles.applySuggestionBtn, (!suggestion.trim() || revising) && styles.btnDisabled]}
              onPress={handleSuggest}
              disabled={!suggestion.trim() || revising}
            >
              {revising ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <>
                  <Text style={{ fontSize: 15 }}>✨</Text>
                  <Text style={styles.applySuggestionText}>Apply with AI</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Send */}
        <TouchableOpacity style={styles.sendBtn} onPress={() => onSend({ to, subject, body })} activeOpacity={0.8}>
          <Text style={{ fontSize: 18 }}>📤</Text>
          <Text style={styles.sendBtnText}>Send Email</Text>
        </TouchableOpacity>
        <Text style={styles.disclaimer}>In the full version, this will send from your connected Gmail account.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SENT CONFIRMATION MODAL
// ═══════════════════════════════════════════════════════════════
function SentModal({ visible, email, onClose }) {
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0.8);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="none">
      <Animated.View style={[styles.modalOverlay, { opacity: opacityAnim }]}>
        <Animated.View style={[styles.modalCard, { transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.sentCheckCircle}>
            <Text style={styles.sentCheck}>✓</Text>
          </View>
          <Text style={styles.sentTitle}>Email Sent!</Text>
          <Text style={styles.sentSubtitle}>Your report has been sent to</Text>
          <Text style={styles.sentEmail}>{email?.to}</Text>
          <Text style={styles.sentNote}>You'll receive updates as your case progresses.</Text>
          <TouchableOpacity style={styles.sentBtn} onPress={onClose}>
            <Text style={styles.sentBtnText}>Report Another Issue</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState("report");
  const [emailData, setEmailData] = useState(null);
  const [revising, setRevising] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const [sentEmail, setSentEmail] = useState(null);

  const handleReportSubmit = async ({ description, location, photo }) => {
    setScreen("loading");
    try {
      const result = await generateEmailDraft({ description, location, hasPhoto: !!photo });
      setEmailData(result);
      setScreen("email");
    } catch (e) {
      setScreen("report");
      Alert.alert("Error", `Failed to generate email draft:\n\n${e.message}`);
    }
  };

  const handleRevise = async ({ currentTo, currentSubject, currentBody, suggestion }) => {
    setRevising(true);
    try {
      const result = await reviseEmailDraft({ currentTo, currentSubject, currentBody, suggestion });
      setEmailData(result);
    } catch (e) {
      Alert.alert("Error", `Failed to revise draft:\n\n${e.message}`);
    }
    setRevising(false);
  };

  const handleSend = (finalEmail) => {
    setSentEmail(finalEmail);
    setShowSent(true);
  };

  const handleReset = () => {
    setShowSent(false);
    setSentEmail(null);
    setEmailData(null);
    setScreen("report");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <View style={styles.appBar}>
        <Text style={styles.appBarTitle}>CivicReport</Text>
        <Text style={styles.appBarBadge}>Palo Alto</Text>
      </View>

      {screen === "report" && <ReportScreen onSubmit={handleReportSubmit} />}
      {screen === "loading" && <LoadingScreen />}
      {screen === "email" && emailData && (
        <EmailScreen email={emailData} onRevise={handleRevise} onSend={handleSend} onBack={handleReset} revising={revising} />
      )}

      <SentModal visible={showSent} email={sentEmail} onClose={handleReset} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // App Bar
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 56 : 44,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  appBarTitle: { fontSize: 20, fontWeight: "700", color: C.primary },
  appBarBadge: {
    fontSize: 13,
    fontWeight: "600",
    color: C.primary,
    backgroundColor: C.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },

  // Screens
  screen: { flex: 1 },
  screenContent: { padding: 20, paddingBottom: 40 },
  centerScreen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },

  // Header
  header: { marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: "700", color: C.text, marginBottom: 6 },
  headerSubtitle: { fontSize: 14, color: C.textSecondary, lineHeight: 20 },

  // Cards
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.border,
  },

  // Labels
  label: { fontSize: 15, fontWeight: "600", color: C.text, marginBottom: 8 },
  labelInline: { fontSize: 15, fontWeight: "600", color: C.text },

  // Text area
  textArea: {
    backgroundColor: C.bg,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: C.text,
    minHeight: 110,
    lineHeight: 22,
  },

  // Row
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },

  // Location
  locationLoading: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 },
  locationLoadingText: { fontSize: 13, color: C.textSecondary },
  locationBadge: { marginTop: 10, backgroundColor: C.accentLight, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  locationBadgeText: { fontSize: 13, color: "#047857", fontWeight: "500" },

  // Photo
  photoButtons: { flexDirection: "row", gap: 10 },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: C.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
  },
  photoBtnText: { fontSize: 14, color: C.textSecondary, fontWeight: "500" },
  photoPreviewContainer: { marginTop: 12, position: "relative" },
  photoPreview: { width: "100%", height: 180, borderRadius: 10 },
  removePhoto: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  removePhotoText: { color: C.white, fontSize: 14, fontWeight: "700" },

  // Buttons
  submitBtn: {
    backgroundColor: C.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 6,
  },
  btnDisabled: { opacity: 0.5 },
  submitBtnText: { color: C.white, fontSize: 16, fontWeight: "600" },

  // Loading
  loadingTitle: { fontSize: 18, fontWeight: "600", color: C.text, marginTop: 20 },
  loadingSubtitle: { fontSize: 14, color: C.textSecondary, marginTop: 6, textAlign: "center" },

  // Email screen
  emailHeader: { marginBottom: 16 },
  backBtn: { marginBottom: 12 },
  backBtnText: { color: C.primary, fontSize: 15, fontWeight: "600" },

  emailCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  emailField: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  emailFieldLabel: { fontSize: 14, fontWeight: "600", color: C.textSecondary, width: 60 },
  emailFieldValue: { flex: 1, fontSize: 14, color: C.text },
  emailFieldInput: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    backgroundColor: C.bg,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  emailDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  emailBodySection: { padding: 16, minHeight: 200 },
  emailBodyText: { fontSize: 15, color: C.text, lineHeight: 24 },
  emailBodyInput: {
    fontSize: 15,
    color: C.text,
    lineHeight: 24,
    backgroundColor: C.bg,
    borderRadius: 8,
    padding: 12,
    minHeight: 200,
  },

  // Email actions
  emailActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  editBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  editBtnText: { fontSize: 14, color: C.textSecondary, fontWeight: "500" },
  suggestBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: C.primaryLight,
    borderRadius: 10,
  },
  suggestBtnText: { fontSize: 14, color: C.primary, fontWeight: "600" },

  // Suggestion
  suggestionCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: C.primary,
  },
  suggestionLabel: { fontSize: 14, fontWeight: "600", color: C.text, marginBottom: 8 },
  suggestionInput: {
    backgroundColor: C.bg,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: C.text,
    minHeight: 70,
    lineHeight: 20,
    marginBottom: 10,
  },
  applySuggestionBtn: {
    backgroundColor: C.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  applySuggestionText: { color: C.white, fontSize: 14, fontWeight: "600" },

  // Send
  sendBtn: {
    backgroundColor: C.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 20,
  },
  sendBtnText: { color: C.white, fontSize: 16, fontWeight: "600" },
  disclaimer: { textAlign: "center", fontSize: 12, color: C.textLight, marginTop: 10 },

  // Website Notice (when email not verified)
  websiteNotice: {
    backgroundColor: "#FEF3C7",
    borderRadius: 14,
    padding: 20,
    marginBottom: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  websiteNoticeIcon: { fontSize: 32, marginBottom: 10 },
  websiteNoticeText: {
    fontSize: 14,
    color: "#92400E",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 14,
  },
  websiteBtn: {
    backgroundColor: "#F59E0B",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  websiteBtnText: { color: C.white, fontSize: 15, fontWeight: "600" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center", padding: 30 },
  modalCard: {
    backgroundColor: C.white,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
  },
  sentCheckCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  sentCheck: { fontSize: 32, color: C.accent, fontWeight: "700" },
  sentTitle: { fontSize: 22, fontWeight: "700", color: C.text, marginBottom: 8 },
  sentSubtitle: { fontSize: 14, color: C.textSecondary },
  sentEmail: { fontSize: 14, fontWeight: "600", color: C.primary, marginTop: 4, marginBottom: 16 },
  sentNote: { fontSize: 13, color: C.textLight, textAlign: "center", marginBottom: 20 },
  sentBtn: {
    backgroundColor: C.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },
  sentBtnText: { color: C.white, fontSize: 15, fontWeight: "600" },
});
