import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const llm = openai('gpt-4o-mini');

const agent = new Agent({
  name: 'Weather Agent',
  model: llm,
  instructions: `
        You are a local activities and travel expert who excels at weather-based planning. Analyze the weather data and provide practical activity recommendations.

        For each day in the forecast, structure your response exactly as follows:

        📅 [Day, Month Date, Year]
        ═══════════════════════════

        🌡️ WEATHER SUMMARY
        • Conditions: [brief description]
        • Temperature: [X°C/Y°F to A°C/B°F]
        • Precipitation: [X% chance]

        🌅 MORNING ACTIVITIES
        Outdoor:
        • [Activity Name] - [Brief description including specific location/route]
          Best timing: [specific time range]
          Note: [relevant weather consideration]

        🌞 AFTERNOON ACTIVITIES
        Outdoor:
        • [Activity Name] - [Brief description including specific location/route]
          Best timing: [specific time range]
          Note: [relevant weather consideration]

        🏠 INDOOR ALTERNATIVES
        • [Activity Name] - [Brief description including specific venue]
          Ideal for: [weather condition that would trigger this alternative]

        ⚠️ SPECIAL CONSIDERATIONS
        • [Any relevant weather warnings, UV index, wind conditions, etc.]

        Guidelines:
        - Suggest 2-3 time-specific outdoor activities per day
        - Include 1-2 indoor backup options
        - For precipitation >50%, lead with indoor activities
        - All activities must be specific to the location
        - Include specific venues, trails, or locations
        - Consider activity intensity based on temperature
        - Keep descriptions concise but informative

        Maintain this exact formatting for consistency, using the emoji and section headers as shown.
        必ず日本語で教えてください
      `,
});

const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string(),
});

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    95: 'Thunderstorm',
  };
  return conditions[code] || 'Unknown';
}

// モックデータを生成する関数
const generateMockGeocodingData = (city: string) => {
  // 一般的な都市のモックデータ
  const mockCities: Record<string, { latitude: number; longitude: number; name: string }> = {
    tokyo: { latitude: 35.6762, longitude: 139.6503, name: 'Tokyo' },
    osaka: { latitude: 34.6937, longitude: 135.5023, name: 'Osaka' },
    kyoto: { latitude: 35.0116, longitude: 135.7681, name: 'Kyoto' },
    london: { latitude: 51.5074, longitude: -0.1278, name: 'London' },
    newyork: { latitude: 40.7128, longitude: -74.0060, name: 'New York' },
    paris: { latitude: 48.8566, longitude: 2.3522, name: 'Paris' },
  };

  const cityLower = city.toLowerCase().replace(/\s+/g, '');
  const matchedCity = mockCities[cityLower] || {
    latitude: 35.6762 + (Math.random() - 0.5) * 10,
    longitude: 139.6503 + (Math.random() - 0.5) * 10,
    name: city,
  };

  return {
    results: [matchedCity],
  };
};

// モック天気データを生成する関数
const generateMockWeatherData = () => {
  const currentHour = new Date().getHours();
  const temperatures = Array.from({ length: 24 }, (_, i) => {
    // 気温の日変化をシミュレート（朝は低く、昼は高い）
    const hour = (currentHour + i) % 24;
    const baseTemp = 20;
    const variation = Math.sin((hour - 6) * Math.PI / 12) * 10;
    const randomness = (Math.random() - 0.5) * 3;
    return baseTemp + variation + randomness;
  });

  const precipitationProbabilities = Array.from({ length: 24 }, () => 
    Math.floor(Math.random() * 100)
  );

  const weatherCodes = [0, 1, 2, 3, 51, 61, 71];
  const randomWeatherCode = weatherCodes[Math.floor(Math.random() * weatherCodes.length)];

  return {
    current: {
      time: new Date().toISOString(),
      precipitation: Math.random() * 10,
      weathercode: randomWeatherCode,
    },
    hourly: {
      precipitation_probability: precipitationProbabilities,
      temperature_2m: temperatures,
    },
  };
};

const fetchWeather = createStep({
  id: 'fetch-weather',
  description: 'Fetches weather forecast for a given city',
  inputSchema: z.object({
    city: z.string().describe('The city to get the weather for'),
  }),
  outputSchema: forecastSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('Input data not found');
    }

    // モック用の遅延を追加（実際のAPIコールをシミュレート）
    await new Promise(resolve => setTimeout(resolve, 500));

    // Geocoding APIのモック
    const geocodingData = generateMockGeocodingData(inputData.city);

    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${inputData.city}' not found`);
    }

    const { latitude, longitude, name } = geocodingData.results[0];

    // Weather APIのモック
    await new Promise(resolve => setTimeout(resolve, 300));
    const data = generateMockWeatherData();

    const forecast = {
      date: new Date().toISOString(),
      maxTemp: Math.max(...data.hourly.temperature_2m),
      minTemp: Math.min(...data.hourly.temperature_2m),
      condition: getWeatherCondition(data.current.weathercode),
      precipitationChance: data.hourly.precipitation_probability.reduce(
        (acc, curr) => Math.max(acc, curr),
        0,
      ),
      location: name,
    };

    return forecast;
  },
});

const planActivities = createStep({
  id: 'plan-activities',
  description: 'Suggests activities based on weather conditions',
  inputSchema: forecastSchema,
  outputSchema: z.object({
    activities: z.string(),
  }),
  execute: async ({ inputData }) => {
    const forecast = inputData;

    if (!forecast) {
      throw new Error('Forecast data not found');
    }

    const prompt = `Based on the following weather forecast for ${forecast.location}, suggest appropriate activities:
      ${JSON.stringify(forecast, null, 2)}
      `;

    const response = await agent.stream([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    let activitiesText = '';

    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      activitiesText += chunk;
    }

    return {
      activities: activitiesText,
    };
  },
});

const weatherWorkflow = createWorkflow({
  id: 'weather-workflow',
  inputSchema: z.object({
    city: z.string().describe('The city to get the weather for'),
  }),
  outputSchema: z.object({
    activities: z.string(),
  }),
})
  .then(fetchWeather)
  .then(planActivities);

weatherWorkflow.commit();

export { weatherWorkflow };
