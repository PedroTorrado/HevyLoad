import { useRouter } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

function Logo() {
  return (
    <Image
      source={require("../../assets/images/logo.png")}
      style={styles.logo}
      resizeMode="contain"
    />
  );
}

export default function Welcome() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={styles.pageFrame}>
        <View style={styles.centered}>
          <Logo />
          <Text style={styles.title}>{t("auth.welcome.title")}</Text>
          <Text style={styles.body}>
            {t("auth.welcome.subtitle")}
          </Text>
          <View style={styles.authActions}>
            <Pressable style={styles.primaryButton} onPress={() => router.push("/auth/signup")}>
              <Text style={styles.primaryButtonText}>{t("auth.welcome.signup")}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => router.push("/auth/signin")}>
              <Text style={styles.secondaryButtonText}>{t("auth.welcome.signin")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 32,
  },
  pageFrame: {
    width: "100%",
    maxWidth: 560,
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 16,
    textAlign: "center",
  },
  body: {
    fontSize: 16,
    color: "#666666",
    lineHeight: 26,
    textAlign: "center",
    marginBottom: 12,
  },
  authActions: {
    width: "100%",
    maxWidth: 320,
    marginTop: 20,
    alignItems: "center",
    gap: 12,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: "#000000",
    paddingVertical: 14,
    borderRadius: 8,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
  secondaryButton: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#000000",
    borderRadius: 8,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    fontSize: 16,
    color: "#000000",
    fontWeight: "600",
    textAlign: "center",
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 20,
  },
});
