import axios, { AxiosInstance, AxiosResponse, AxiosError } from "axios";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  SignUpData,
  SignInData,
  MealAnalysisData,
  QuestionnaireData,
} from "../types";

// Enhanced error handling and retry logic
class APIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "APIError";
  }
}

// Optimized API configuration
const getApiBaseUrl = (): string => {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error("API_URL environment variable is not configured");
  }
  return baseUrl;
};

// Enhanced axios instance with better error handling
const createApiInstance = (): AxiosInstance => {
  const instance = axios.create({
    baseURL: getApiBaseUrl(),
    timeout: 15000, // 15 second timeout
    withCredentials: Platform.OS === "web",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  // Request interceptor for auth tokens
  instance.interceptors.request.use(
    async (config) => {
      try {
        const token = await getStoredToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      } catch (error) {
        console.warn("Failed to get stored token:", error);
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Enhanced response interceptor with retry logic
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as any;

      // Handle network errors with retry
      if (!error.response && !originalRequest._retry) {
        originalRequest._retry = true;
        console.log("🔄 Retrying failed network request...");

        // Wait 1 second before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return instance(originalRequest);
      }

      // Handle 401 errors (token expiration/invalid token)
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          // Clear invalid token
          await clearStoredToken();
          console.log("🔒 Token invalid/expired - clearing and logging out");

          // Import store dynamically to avoid circular dependencies
          const { store } = await import("../store");
          const { signOut } = await import("../store/authSlice");

          // Dispatch logout
          store.dispatch(signOut());

          // Redirect to welcome page using router
          const { router } = await import("expo-router");
          router.replace("/(auth)/welcome");
        } catch (clearError) {
          console.warn("⚠️ Failed to handle 401 error:", clearError);
        }
      }

      // Transform error for better handling
      const apiError = new APIError(
        error.message || "Network error",
        error.response?.status,
        error.code,
        error.response?.status ? error.response.status >= 500 : true
      );

      return Promise.reject(apiError);
    }
  );

  return instance;
};

const api = createApiInstance();

// Enhanced token management with error handling
const getStoredToken = async (): Promise<string | null> => {
  try {
    if (Platform.OS === "web") {
      return localStorage.getItem("auth_token");
    } else {
      return await SecureStore.getItemAsync("auth_token_secure");
    }
  } catch (error) {
    console.error("Error getting stored token:", error);
    return null;
  }
};

const setStoredToken = async (token: string): Promise<void> => {
  try {
    if (Platform.OS === "web") {
      localStorage.setItem("auth_token", token);
    } else {
      await SecureStore.setItemAsync("auth_token_secure", token);
    }
  } catch (error) {
    console.error("Error storing token:", error);
    throw new APIError("Failed to store authentication token");
  }
};

const clearStoredToken = async (): Promise<void> => {
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem("auth_token");
    } else {
      await SecureStore.deleteItemAsync("auth_token_secure");
    }
  } catch (error) {
    console.error("Error clearing token:", error);
  }
};

// Enhanced API service with comprehensive error handling
export const authAPI = {
  async signUp(data: SignUpData): Promise<any> {
    try {
      console.log("🔄 Signing up user...");
      const response = await api.post("/auth/signup", data);

      if (response.data.success) {
        console.log("✅ Signup successful");
        return response.data;
      }

      throw new APIError(response.data.error || "Signup failed");
    } catch (error) {
      console.error("💥 Signup error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error during signup",
        undefined,
        undefined,
        true
      );
    }
  },

  async signIn(data: SignInData): Promise<any> {
    try {
      console.log("🔄 Signing in user...");
      const response = await api.post("/auth/signin", data);

      if (response.data.success && response.data.token) {
        await setStoredToken(response.data.token);
        console.log("✅ Signin successful, token stored");
        console.log("📦 Raw signin response:", JSON.stringify(response.data, null, 2));
        console.log("👤 User from signin:", JSON.stringify(response.data.user, null, 2));
        console.log("🔑 Admin fields from API:", {
          is_admin: response.data.user?.is_admin,
          is_super_admin: response.data.user?.is_super_admin
        });
        return response.data;
      }

      throw new APIError(response.data.error || "Signin failed");
    } catch (error) {
      console.error("💥 Signin error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error during signin",
        undefined,
        undefined,
        true
      );
    }
  },

  async verifyEmail(email: string, code: string): Promise<any> {
    try {
      console.log("🔄 Verifying email...");
      const response = await api.post("/auth/verify-email", { email, code });

      if (response.data.success && response.data.token) {
        await setStoredToken(response.data.token);
        console.log("✅ Email verification successful");
        return response.data;
      }

      throw new APIError(response.data.error || "Email verification failed");
    } catch (error) {
      console.error("💥 Email verification error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error during email verification",
        undefined,
        undefined,
        true
      );
    }
  },

  signOut: async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem("auth_token");
      if (Platform.OS !== "web") {
        const SecureStore = require("expo-secure-store");
        await SecureStore.deleteItemAsync("auth_token_secure");
      }
      delete api.defaults.headers.common["Authorization"];
    } catch (error) {
      console.error("Error during sign out:", error);
    }
  },

  uploadAvatar: async (
    base64Image: string
  ): Promise<{ success: boolean; avatar_url?: string; error?: string }> => {
    try {
      const response = await api.post("/user/avatar", {
        avatar_base64: base64Image,
      });
      return response.data;
    } catch (error: any) {
      console.error("Upload avatar error:", error);
      return {
        success: false,
        error: error.response?.data?.error || "Failed to upload avatar",
      };
    }
  },

  async getStoredToken(): Promise<string | null> {
    return getStoredToken();
  },

  // Added getCurrentUser function to fetch user data from /auth/me
  async getCurrentUser(): Promise<any> {
    try {
      console.log("🔄 Fetching current user...");
      const response = await api.get("/auth/me");
      console.log("✅ Current user fetched:", response.data);
      console.log("👤 Full user data:", JSON.stringify(response.data.user, null, 2));
      return response.data;
    } catch (error: any) {
      console.error("💥 Get current user error:", error);
      throw error.response?.data || error;
    }
  },
};

// Daily Goals API
export const dailyGoalsAPI = {
  async getDailyGoals(): Promise<any> {
    try {
      console.log("🎯 Fetching daily goals...");
      const response = await api.get("/daily-goals");

      if (response.data.success) {
        console.log("✅ Daily goals fetched successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to fetch daily goals");
    } catch (error) {
      console.error("💥 Get daily goals error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while fetching daily goals");
    }
  },

  async getHistoricalGoals(startDate: string, endDate: string): Promise<any> {
    try {
      console.log("📊 Fetching historical daily goals...");
      console.log("📅 Date range:", startDate, "to", endDate);
      const response = await api.get("/daily-goals/history", {
        params: { startDate, endDate },
      });

      if (response.data.success) {
        console.log(
          `✅ Retrieved ${response.data.data.length} historical goals`
        );
        return response.data;
      }

      throw new APIError(
        response.data.error || "Failed to fetch historical daily goals"
      );
    } catch (error) {
      console.error("💥 Get historical daily goals error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while fetching historical daily goals");
    }
  },

  async getDailyGoalByDate(date: string): Promise<any> {
    try {
      console.log("📊 Fetching daily goal for date:", date);
      const response = await api.get(`/daily-goals/by-date/${date}`);

      if (response.data.success) {
        console.log("✅ Daily goal fetched successfully for", date);
        return response.data;
      }

      throw new APIError(
        response.data.error || "Failed to fetch daily goal for date"
      );
    } catch (error) {
      console.error("💥 Get daily goal by date error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while fetching daily goal by date");
    }
  },

  async createDailyGoals(): Promise<any> {
    try {
      console.log("🎯 Creating daily goals...");
      const response = await api.put("/daily-goals");

      if (response.data.success) {
        console.log("✅ Daily goals created successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to create daily goals");
    } catch (error) {
      console.error("💥 Create daily goals error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while creating daily goals");
    }
  },

  async verifyDailyGoals(): Promise<any> {
    try {
      console.log("🔍 Verifying daily goals...");
      const response = await api.get("/daily-goals/verify");

      if (response.data.success) {
        console.log("✅ Daily goals verified successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to verify daily goals");
    } catch (error) {
      console.error("💥 Verify daily goals error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while verifying daily goals");
    }
  },
};

// Enhanced nutrition API with better error handling
export const nutritionAPI = {
  async analyzeMeal(
    imageBase64: string,
    updateText?: string,
    editedIngredients: any[] = [],
    language: string = "en",
    mealPeriod?: string
  ): Promise<any> {
    try {
      console.log("🔄 Analyzing meal...");

      if (!imageBase64 || imageBase64.trim() === "") {
        throw new APIError("Image data is required");
      }

      // Enhanced timeout and retry logic
      const ANALYSIS_TIMEOUT = 45000; // 45 seconds
      const MAX_RETRIES = 2;

      let lastError: any;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`🔄 Analysis attempt ${attempt + 1}/${MAX_RETRIES + 1}`);

          const source = axios.CancelToken.source();
          const timeout = setTimeout(() => {
            source.cancel(
              "Analysis timeout - please try again with a clearer image"
            );
          }, ANALYSIS_TIMEOUT);

          try {
            const response = await api.post(
              "/nutrition/analyze",
              {
                imageBase64: imageBase64.trim(),
                updateText,
                editedIngredients,
                language,
                mealPeriod,
              },
              {
                cancelToken: source.token,
                timeout: ANALYSIS_TIMEOUT,
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
              }
            );

            clearTimeout(timeout);

            if (response.data.success) {
              console.log("✅ Meal analysis successful");
              return response.data;
            }

            throw new APIError(response.data.error || "Analysis failed");
          } catch (axiosError: any) {
            clearTimeout(timeout);
            lastError = axiosError;

            if (axios.isCancel(axiosError)) {
              throw new APIError(
                "Analysis timeout - please try again with a clearer image"
              );
            }

            if (axiosError.code === "ECONNABORTED") {
              throw new APIError(
                "Connection timeout - please check your internet connection"
              );
            }

            // If this is a network error and we have retries left, continue to next attempt
            if (
              attempt < MAX_RETRIES &&
              (axiosError.code === "ERR_NETWORK" ||
                axiosError.message?.includes("Network Error") ||
                axiosError.response?.status >= 500)
            ) {
              console.log(
                `⚠️ Network error on attempt ${attempt + 1}, retrying...`
              );
              // Wait before retry with exponential backoff
              await new Promise((resolve) =>
                setTimeout(resolve, Math.pow(2, attempt) * 1000)
              );
              continue;
            }

            throw axiosError;
          }
        } catch (error) {
          lastError = error;

          // If this is the last attempt or not a retryable error, break
          if (attempt === MAX_RETRIES || !this.isRetryableError(error)) {
            break;
          }

          console.log(
            `⚠️ Retryable error on attempt ${attempt + 1}, retrying...`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
        }
      }

      // If we get here, all retries failed
      throw lastError;
    } catch (error: any) {
      console.error("💥 Meal analysis error:", error);
      if (error instanceof APIError) throw error;

      if (error.response?.status === 408) {
        throw new APIError(
          "Analysis is taking too long. Please try with a clearer image."
        );
      }

      if (error.response?.data?.error) {
        throw new APIError(error.response.data.error);
      }

      throw new APIError(
        "Network error during meal analysis. Please check your connection and try again.",
        undefined,
        undefined,
        true
      );
    }
  },

  // Helper method to determine if an error is retryable
  isRetryableError(error: any): boolean {
    if (!error) return false;

    // Network errors are retryable
    if (
      error.code === "ERR_NETWORK" ||
      error.message?.includes("Network Error")
    ) {
      return true;
    }

    // Server errors (5xx) are retryable
    if (error.response?.status >= 500) {
      return true;
    }

    // Timeout errors are retryable
    if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
      return true;
    }

    return false;
  },

  async addShoppingItem(
    name: string,
    quantity: number = 1,
    unit: string = "pieces",
    category: string = "Manual"
  ): Promise<any> {
    try {
      console.log("📦 Adding shopping item optimized...");
      const response = await api.post("/shopping-lists", {
        name: name.trim(),
        quantity: quantity,
        unit: unit,
        category: category,
        added_from: "manual",
      });

      if (response.data.success) {
        console.log("✅ Shopping item added successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to add item");
    } catch (error) {
      console.error("💥 Add shopping item error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error while adding item",
        undefined,
        undefined,
        true
      );
    }
  },

  async saveMeal(
    mealData: MealAnalysisData,
    imageBase64?: string
  ): Promise<any> {
    try {
      console.log("🔄 Saving meal...");
      const response = await api.post("/nutrition/save", {
        mealData,
        imageBase64,
      });

      if (response.data.success) {
        console.log("✅ Meal saved successfully");
        return response.data.data;
      }

      throw new APIError(response.data.error || "Failed to save meal");
    } catch (error) {
      console.error("💥 Save meal error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error while saving meal",
        undefined,
        undefined,
        true
      );
    }
  },

  async getMeals(offset: number = 0, limit: number = 100): Promise<any[]> {
    try {
      console.log("🔄 Fetching meals...");
      const response = await api.get(
        `/nutrition/meals?offset=${offset}&limit=${limit}`
      );

      if (response.data.success) {
        console.log(`✅ Fetched ${response.data.data.length} meals`);
        return response.data.data;
      }

      throw new APIError(response.data.error || "Failed to fetch meals");
    } catch (error) {
      console.error("💥 Get meals error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error while fetching meals",
        undefined,
        undefined,
        true
      );
    }
  },

  async updateMeal(mealId: string, updateText: string): Promise<any> {
    try {
      console.log("🔄 Updating meal...");
      const response = await api.put("/nutrition/update", {
        meal_id: mealId,
        updateText,
      });

      if (response.data.success) {
        console.log("✅ Meal updated successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to update meal");
    } catch (error) {
      console.error("💥 Update meal error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error while updating meal",
        undefined,
        undefined,
        true
      );
    }
  },

  async getDailyStats(date: string): Promise<any> {
    try {
      const response = await api.get(`/nutrition/stats/daily?date=${date}`);
      return response.data.success ? response.data.data : {};
    } catch (error) {
      console.error("💥 Get daily stats error:", error);
      return {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sugar: 0,
        meal_count: 0,
      };
    }
  },

  async getRangeStatistics(startDate: string, endDate: string): Promise<any> {
    try {
      const { requestDeduplicator, createRequestKey } = await import(
        "@/src/utils/requestDeduplication"
      );
      const requestKey = createRequestKey("GET", "/nutrition/stats/range", {
        startDate,
        endDate,
      });

      return requestDeduplicator.deduplicate(requestKey, async () => {
        console.log(
          `📊 Making statistics API call: ${startDate} to ${endDate}`
        );
        const response = await api.get("/nutrition/stats/range", {
          params: { startDate, endDate },
          timeout: 35000, // 35 second timeout
        });
        return response.data;
      });
    } catch (error: any) {
      console.error("💥 Range statistics error:", error);

      if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
        throw new APIError(
          "Statistics request timed out. Please try again with a shorter time period.",
          408,
          "TIMEOUT",
          true
        );
      }

      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error while fetching statistics",
        undefined,
        undefined,
        true
      );
    }
  },

  async saveMealFeedback(mealId: string, feedback: any): Promise<any> {
    try {
      const response = await api.post(
        `/nutrition/meals/${mealId}/feedback`,
        feedback
      );
      return response.data;
    } catch (error) {
      console.error("💥 Save feedback error:", error);
      throw new APIError("Failed to save meal feedback");
    }
  },

  async toggleMealFavorite(mealId: string): Promise<any> {
    try {
      const response = await api.post(`/nutrition/meals/${mealId}/favorite`);
      return response.data;
    } catch (error) {
      console.error("💥 Toggle favorite error:", error);
      throw new APIError("Failed to toggle meal favorite");
    }
  },

  async duplicateMeal(mealId: string, newDate?: string): Promise<any> {
    try {
      const response = await api.post(`/nutrition/meals/${mealId}/duplicate`, {
        newDate: newDate || new Date().toISOString().split("T")[0],
      });
      return response.data;
    } catch (error) {
      console.error("💥 Duplicate meal error:", error);
      throw new APIError("Failed to duplicate meal");
    }
  },

  async removeMeal(mealId: string): Promise<void> {
    try {
      await api.delete(`/nutrition/meals/${mealId}`);
      console.log("✅ Meal removed successfully");
    } catch (error) {
      console.error("💥 Remove meal error:", error);
      throw new APIError("Failed to remove meal");
    }
  },

  async addManualMeal(mealData: {
    mealName: string;
    calories: string;
    protein?: string;
    carbs?: string;
    fat?: string;
    fiber?: string;
    sugar?: string;
    sodium?: string;
    ingredients?: string[];
    mealPeriod?: string;
    imageUrl?: string;
    date?: string;
  }): Promise<any> {
    try {
      console.log("📝 Adding manual meal...");
      const response = await api.post("/nutrition/meals/manual", mealData);

      if (response.data.success) {
        console.log("✅ Manual meal added successfully");
        return response;
      }

      throw new APIError(response.data.error || "Failed to add manual meal");
    } catch (error) {
      console.error("💥 Add manual meal error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error while adding manual meal",
        undefined,
        undefined,
        true
      );
    }
  },

  async getUsageStats(): Promise<any> {
    try {
      console.log("📊 Fetching usage stats...");
      const response = await api.get("/nutrition/usage-stats");

      if (response.data.success) {
        console.log("✅ Usage stats fetched successfully");
        return response.data.data;
      }

      throw new APIError(response.data.error || "Failed to fetch usage stats");
    } catch (error) {
      console.error("💥 Get usage stats error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Network error while fetching usage stats",
        undefined,
        undefined,
        true
      );
    }
  },
};

// Enhanced user API
export const userAPI = {
  async updateProfile(profileData: any): Promise<any> {
    try {
      const response = await api.put("/user/profile", profileData);
      return response.data;
    } catch (error) {
      console.error("💥 Update profile error:", error);
      throw new APIError("Failed to update profile");
    }
  },

  updateSubscription: async (subscriptionType: string) => {
    const response = await api.put("/user/subscription", {
      subscription_type: subscriptionType,
    });
    return response.data;
  },

  deleteAccount: async () => {
    const response = await api.delete("/user/delete");
    return response.data;
  },

  getUserProfile: async (): Promise<any> => {
    try {
      const response = await api.get("/user/profile");
      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
        };
      }
      throw new APIError(response.data.error || "Failed to fetch profile");
    } catch (error) {
      console.error("Get profile error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while fetching profile");
    }
  },

  getUserStats: async (): Promise<any> => {
    try {
      console.log("🔄 Fetching user stats...");
      const response = await api.get("/user/stats", { timeout: 8000 });
      if (response.data.success) {
        console.log("✅ User stats fetched successfully");
        return response.data.data;
      }
      throw new APIError(response.data.error || "Failed to fetch user stats");
    } catch (error: any) {
      console.error("💥 Error fetching user stats:", error);
      // Return default stats if API fails
      const defaultStats = {
        totalMeals: 0,
        todayWaterIntake: 0,
        totalAchievements: 0,
        streak: 0,
        memberSince: new Date(),
        subscriptionType: "free",
        questionnaireCompleted: false,
      };
      console.log("📊 Returning default user stats");
      return defaultStats;
    }
  },

  async uploadAvatar(base64Image: string): Promise<any> {
    try {
      console.log("🔄 Uploading avatar...");
      const response = await api.post("/user/avatar", {
        avatar_base64: base64Image,
      });

      if (response.data.success) {
        console.log("✅ Avatar uploaded successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to upload avatar");
    } catch (error) {
      console.error("💥 Upload avatar error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while uploading avatar");
    }
  },

  async getGlobalStatistics(): Promise<any> {
    try {
      const response = await api.get("/user/global-statistics");
      return response.data;
    } catch (error) {
      console.error("💥 Get global statistics error:", error);
      throw new APIError("Failed to get global statistics");
    }
  },
  async getAIRecommendations(): Promise<any> {
    try {
      const response = await api.get("/recommendations/today");
      console.log(response.data);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch AI recommendations:", error);
      throw error; // Re-throw so calling code can handle it
    }
  },
  async forgotPassword(email: string): Promise<any> {
    try {
      console.log("🔄 Sending forgot password request...");
      const response = await api.post("/auth/forgot-password", { email });

      if (response.data.success) {
        console.log("✅ Forgot password email sent");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to send reset email");
    } catch (error) {
      console.error("💥 Forgot password error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error during password reset request");
    }
  },

  async verifyResetCode(email: string, code: string): Promise<any> {
    try {
      console.log("🔄 Verifying reset code...");
      const response = await api.post("/auth/verify-reset-code", {
        email,
        code,
      });

      if (response.data.success) {
        console.log("✅ Reset code verified");
        return response.data;
      }

      throw new APIError(response.data.error || "Invalid reset code");
    } catch (error) {
      console.error("💥 Verify reset code error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error during code verification");
    }
  },

  async resetPassword(token: string, newPassword: string): Promise<any> {
    try {
      console.log("🔄 Resetting password...");
      const response = await api.post("/auth/reset-password", {
        token,
        newPassword,
      });

      if (response.data.success) {
        console.log("✅ Password reset successful");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to reset password");
    } catch (error) {
      console.error("💥 Reset password error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error during password reset");
    }
  },
};

// Enhanced questionnaire API
export const questionnaireAPI = {
  async saveQuestionnaire(data: QuestionnaireData): Promise<any> {
    try {
      console.log("🔄 Saving questionnaire...");
      const response = await api.post("/questionnaire", data);

      if (response.data.success) {
        console.log("✅ Questionnaire saved successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to save questionnaire");
    } catch (error) {
      console.error("💥 Save questionnaire error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while saving questionnaire");
    }
  },

  async getQuestionnaire(): Promise<any> {
    try {
      const response = await api.get("/questionnaire");
      return response.data;
    } catch (error) {
      console.error("💥 Get questionnaire error:", error);
      throw new APIError("Failed to get questionnaire");
    }
  },
};

// Enhanced chat API
export const chatAPI = {
  async sendMessage(
    message: string,
    language: string = "hebrew"
  ): Promise<any> {
    try {
      console.log("🔄 Sending chat message...");

      if (!message || message.trim() === "") {
        throw new APIError("Message cannot be empty");
      }

      const response = await api.post("/chat/message", {
        message: message.trim(),
        language,
      });

      if (response.data.success) {
        console.log("✅ Chat message sent successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to send message");
    } catch (error) {
      console.error("💥 Chat message error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while sending message");
    }
  },

  async getChatHistory(limit: number = 50): Promise<any> {
    try {
      const response = await api.get(`/chat/history?limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error("💥 Get chat history error:", error);
      return { success: false, data: [] };
    }
  },

  async clearHistory(): Promise<any> {
    try {
      const response = await api.delete("/chat/history");
      return response.data;
    } catch (error) {
      console.error("💥 Clear chat history error:", error);
      throw new APIError("Failed to clear chat history");
    }
  },
};

// Enhanced calendar API
export const calendarAPI = {
  async getCalendarData(year: number, month: number): Promise<any> {
    try {
      const response = await api.get(`/calendar/data/${year}/${month}`);
      return response.data.success ? response.data.data : {};
    } catch (error) {
      console.error("💥 Get calendar data error:", error);
      return {};
    }
  },

  async getStatistics(year: number, month: number): Promise<any> {
    try {
      const response = await api.get(`/calendar/statistics/${year}/${month}`);
      return response.data.success ? response.data.data : null;
    } catch (error) {
      console.error("💥 Get calendar statistics error:", error);
      return null;
    }
  },

  async addEvent(
    date: string,
    title: string,
    type: string,
    description?: string
  ): Promise<any> {
    try {
      const response = await api.post("/calendar/events", {
        date,
        title,
        type,
        description,
      });
      return response.data;
    } catch (error) {
      console.error("💥 Add event error:", error);
      throw new APIError("Failed to add event");
    }
  },

  async getEventsForDate(date: string): Promise<any[]> {
    try {
      const response = await api.get(`/calendar/events/${date}`);
      return response.data.success ? response.data.data : [];
    } catch (error) {
      console.error("💥 Get events error:", error);
      return [];
    }
  },

  async deleteEvent(eventId: string): Promise<void> {
    try {
      await api.delete(`/calendar/events/${eventId}`);
      console.log("✅ Event deleted successfully");
    } catch (error) {
      console.error("💥 Delete event error:", error);
      throw new APIError("Failed to delete event");
    }
  },
};

// Enhanced meal API
export const mealAPI = {
  async deleteMeal(mealId: string): Promise<void> {
    try {
      console.log("🔄 Deleting meal:", mealId);
      await api.delete(`/nutrition/meals/${mealId}`);
      console.log("✅ Meal deleted successfully");
    } catch (error) {
      console.error("💥 Delete meal error:", error);
      throw new APIError("Failed to delete meal");
    }
  },

  async updateMeal(mealId: string, updateData: any): Promise<any> {
    try {
      const response = await api.put(`/nutrition/meals/${mealId}`, updateData);
      return response.data;
    } catch (error) {
      console.error("💥 Update meal error:", error);
      throw new APIError("Failed to update meal");
    }
  },
};

// Enhanced meal plan API
export const mealPlanAPI = {
  async getCurrentMealPlan(): Promise<any> {
    try {
      console.log("🔄 Fetching current meal plan...");
      const response = await api.get("/meal-plans/current");

      if (response.data.success) {
        console.log("✅ Current meal plan fetched successfully");
        return response.data;
      }

      throw new APIError(
        response.data.error || "Failed to fetch current meal plan"
      );
    } catch (error) {
      console.error("💥 Get current meal plan error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while fetching current meal plan");
    }
  },

  async getMealPlanById(planId: string): Promise<any> {
    try {
      console.log("🔄 Fetching meal plan by ID:", planId);
      const response = await api.get(`/meal-plans/${planId}`);

      if (response.data.success) {
        console.log("✅ Meal plan fetched successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to fetch meal plan");
    } catch (error) {
      console.error("💥 Get meal plan by ID error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while fetching meal plan");
    }
  },

  async getRecommendedMenus(): Promise<any> {
    try {
      console.log("🔄 Fetching recommended menus...");
      const response = await api.get("/meal-plans/recommended");

      if (response.data.success) {
        console.log("✅ Recommended menus fetched successfully");
        return response.data;
      }

      throw new APIError(
        response.data.error || "Failed to fetch recommended menus"
      );
    } catch (error) {
      console.error("💥 Get recommended menus error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while fetching recommended menus");
    }
  },

  async activateMealPlan(planId: string): Promise<any> {
    try {
      console.log("🔄 Activating meal plan:", planId);
      const response = await api.post(`/meal-plans/${planId}/activate`);

      if (response.data.success) {
        console.log("✅ Meal plan activated successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to activate meal plan");
    } catch (error) {
      console.error("💥 Activate meal plan error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while activating meal plan");
    }
  },

  async replaceMealInPlan(
    planId: string,
    dayOfWeek: number,
    mealTiming: string,
    preferences: any
  ): Promise<any> {
    try {
      console.log("🔄 Replacing meal in plan...");
      const response = await api.put(
        `/meal-plans/${planId}/replace`,
        {
          day_of_week: dayOfWeek,
          meal_timing: mealTiming,
          meal_order: 0,
          preferences: preferences,
        },
        {
          timeout: 15000, // 15 second timeout for meal replacement
        }
      );

      if (response.data.success) {
        console.log("✅ Meal replaced successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to replace meal");
    } catch (error: any) {
      console.error("💥 Replace meal error:", error);

      if (error.response?.data?.error) {
        throw new APIError(error.response.data.error);
      }

      if (error.code === "ECONNABORTED") {
        throw new APIError("Request timeout - please try again");
      }

      if (error instanceof APIError) throw error;
      throw new APIError("Network error while replacing meal");
    }
  },

  async completeMealPlan(planId: string, feedback: any): Promise<any> {
    try {
      console.log("🔄 Completing meal plan...");
      const response = await api.post(
        `/meal-plans/${planId}/complete`,
        feedback
      );

      if (response.data.success) {
        console.log("✅ Meal plan completed successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to complete meal plan");
    } catch (error) {
      console.error("💥 Complete meal plan error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while completing meal plan");
    }
  },

  // Added swapMeal method
  async swapMeal(planId: string, swapRequest: any): Promise<any> {
    try {
      console.log("🔄 Swapping meal in plan...");
      const response = await api.post(
        `/meal-plans/${planId}/swap-meal`,
        swapRequest
      );

      if (response.data.success) {
        console.log("✅ Meal swapped successfully");
        return response.data;
      }

      throw new APIError(response.data.error || "Failed to swap meal");
    } catch (error) {
      console.error("💥 Swap meal error:", error);
      if (error instanceof APIError) throw error;
      throw new APIError("Network error while swapping meal");
    }
  },
};

// Export the main API instance for direct use
export { api };

// Export error class for error handling
export { APIError };