#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// 和风天气 API 的基础 URL 和 API 密钥
// HeFeng Weather API base URL and API key
let HEFENG_WEATHER_API_URL = "";
let HEFENG_GEO_API_URL = "";
let HEFENG_API_KEY = "";

// 从命令行参数读取 API 密钥
// Read API key from command line arguments
const apiKeyArg = process.argv.find(arg => arg.startsWith('--apiKey='));
if (apiKeyArg) {
    const apiKey = apiKeyArg.split('=')[1];
    if (apiKey) {
        console.log(`使用命令行参数中的API密钥`); // Using API key from command line arguments (Key value itself is not logged for security)
        HEFENG_API_KEY = apiKey;
    }
}

// 从命令行参数读取 API URL (用于天气和地理位置API)
// Read API URL from command line arguments (for weather and geolocation APIs)
const apiUrlArg = process.argv.find(arg => arg.startsWith('--apiUrl='));
if (apiUrlArg) {
    const apiUrl = apiUrlArg.split('=')[1];
    if (apiUrl) {
        console.log(`使用命令行参数中的 API URL: ${apiUrl}`); // Using API URL from command line arguments
        HEFENG_WEATHER_API_URL = apiUrl;
        HEFENG_GEO_API_URL = apiUrl;
    }
}

if (!HEFENG_API_KEY) {
    console.warn("警告: 未提供 HEFENG_API_KEY。API 调用可能会失败。请使用 --apiKey=<你的密钥> 参数提供。");
}
if (!HEFENG_WEATHER_API_URL) {
    console.warn("警告: 未提供 HEFENG_WEATHER_API_URL (天气API基础URL)。天气 API 调用可能会失败。请使用 --apiUrl=<API基础URL> 参数提供。");
}
if (!HEFENG_GEO_API_URL) {
    console.warn("警告: 未配置 HEFENG_GEO_API_URL (地理位置API基础URL)。城市ID查询功能可能受影响。请使用 --apiUrl=<API基础URL> 参数提供。");
}


// 定义城市信息查询参数的 Zod schema
// Define Zod schema for city information query parameters
const LocationIdArgumentsSchema = z.object({
    city_name: z.string().describe("需要查询的城市名称（如'beijing'）、以英文逗号分隔的经度,纬度坐标（十进制，最多支持小数点后两位）、LocationID或Adcode（仅限中国城市）。例如: beijing 或 116.41,39.92。不再支持中文直接输入。"),
});

// 定义天气查询参数的 Zod schema
// Define Zod schema for weather query parameters
const WeatherArgumentsSchema = z.object({
    location: z.string().describe("需要查询地区的LocationID或以英文逗号分隔的经度,纬度坐标（十进制，最多支持小数点后两位）。例如: 101010100 或 116.41,39.92。"), // Updated description
    days: z.enum(['now', '24h', '72h', '168h', '3d', '7d', '10d', '15d', '30d']).default('now').describe("预报类型。now:实时天气, 24h/72h/168h:逐小时预报, 3d/7d/10d/15d/30d:逐天预报"),
});

// 创建服务器实例
// Create server instance
const server = new Server(
    {
        name: "hefeng-mcp-server",
        version: "1.6.2", // Server version remains 1.6.0
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// 列出可用工具
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_weather",
                description: "获取指定地点的天气预报。请提供LocationID或经纬度坐标。", // Updated tool description
                inputSchema: {
                    type: "object",
                    properties: {
                        location: {
                            type: "string",
                            description: "需要查询地区的LocationID或以英文逗号分隔的经度,纬度坐标（十进制，最多支持小数点后两位）。例如: 101010100 或 116.41,39.92。", // Updated property description
                        },
                        days: {
                            type: "string",
                            enum: ["now", "24h", "72h", "168h", "3d", "7d", "10d", "15d", "30d"],
                            description: "预报类型。now:实时天气, 24h/72h/168h:逐小时预报, 3d/7d/10d/15d/30d:逐天预报",
                            default: "now"
                        }
                    },
                    required: ["location"],
                },
            },
            {
                name: "get_location_id",
                description: "根据城市名称（拼音/英文）、经纬度、LocationID或Adcode获取其精确的位置ID和详细地理信息。",
                inputSchema: {
                    type: "object",
                    properties: {
                        city_name: {
                            type: "string",
                            description: "需要查询地区的名称（拼音如'beijing'）、以英文逗号分隔的经度,纬度坐标（例如 116.41,39.92）、LocationID或Adcode（仅限中国城市）。",
                        },
                    },
                    required: ["city_name"],
                },
            }
        ],
    };
});

// 和风天气 API 响应体接口定义
// HeFeng Weather API response body interface definitions (remain the same)
interface HeFengLocation {
    name: string;
    id: string;
    lat: string;
    lon: string;
    adm2: string;
    adm1: string;
    country: string;
    tz?: string;
    utcOffset?: string;
    isDst?: string;
    type?: string;
    rank?: string;
    fxLink?: string;
}

interface HeFengCityLookupResponse {
    code: string;
    location?: HeFengLocation[];
    refer?: {
        sources: string[];
        license: string[];
    };
}

interface HeFengNowObject {
    obsTime: string;
    temp: string;
    feelsLike: string;
    text: string;
    windDir: string;
    windScale: string;
    humidity: string;
    precip: string;
    pressure: string;
    vis: string;
    cloud?: string;
    dew?: string;
}

interface HeFengHourlyObject {
    fxTime: string;
    temp: string;
    text: string;
    windDir: string;
    windScale: string;
    humidity: string;
    pop?: string;
    precip?: string;
    pressure?: string;
    cloud?: string;
    dew?: string;
}

interface HeFengDailyObject {
    fxDate: string;
    tempMax: string;
    tempMin: string;
    textDay: string;
    textNight: string;
    windDirDay: string;
    windScaleDay: string;
    windDirNight: string;
    windScaleNight: string;
    humidity: string;
    precip: string;
    pressure: string;
    vis: string;
    uvIndex: string;
    sunrise?: string;
    sunset?: string;
}

interface HeFengWeatherNowResponse {
    code: string;
    now?: HeFengNowObject;
    refer?: {
        sources: string[];
        license: string[];
    };
}

interface HeFengWeatherDailyResponse {
    code: string;
    daily?: HeFengDailyObject[];
    refer?: {
        sources: string[];
        license: string[];
    };
}

interface HeFengWeatherHourlyResponse {
    code: string;
    hourly?: HeFengHourlyObject[];
    refer?: {
        sources: string[];
        license: string[];
    };
}

// 辅助函数：执行和风天气 API 请求
// Helper function: Execute HeFeng Weather API request
async function makeHeFengRequest<T>(baseUrl: string, path: string, params: Record<string, string>): Promise<T | { code: string; error?: string; message?: string } | null> {
    if (!HEFENG_API_KEY) {
        console.error("错误: HEFENG_API_KEY 未设置。");
        return { code: "500", error: "API Key not configured" };
    }
    if (!baseUrl) {
        console.error(`错误: API 基础 URL 未设置。`);
        return { code: "500", error: "API Base URL not configured" };
    }

    const queryParams = new URLSearchParams(params);
    const fullUrl = `${baseUrl}${path}?${queryParams.toString()}`;

    console.log(`发起请求: ${fullUrl} (API Key in X-QW-Api-Key Header)`);

    try {
        const response = await fetch(fullUrl, {
            headers: {
                'X-QW-Api-Key': HEFENG_API_KEY,
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`HTTP 错误! 状态: ${response.status}, URL: ${fullUrl}`);
            console.error(`错误详情: ${errorBody}`);
            try {
                const hefengErrorWrapper = JSON.parse(errorBody) as { error?: { status?: number; title?: string; detail?: string; } };
                if (hefengErrorWrapper.error && (hefengErrorWrapper.error.detail || hefengErrorWrapper.error.title)) {
                    return {
                        code: String(hefengErrorWrapper.error.status || response.status),
                        error: `HeFeng API Error: ${hefengErrorWrapper.error.title || 'Unknown Error'}. Detail: ${hefengErrorWrapper.error.detail || 'No detail provided.'}`
                    };
                }
                const hefengCommonError = JSON.parse(errorBody) as {code?: string, message?: string};
                if (hefengCommonError.code) {
                     return {
                        code: hefengCommonError.code,
                        error: `HeFeng API Error (Code: ${hefengCommonError.code}): ${hefengCommonError.message || errorBody}`
                    };
                }
            } catch (e) {
                console.error("解析和风API错误响应JSON失败或结构不符:", e);
            }
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
        }
        const data = (await response.json()) as T & { code?: string };
        if (data.code && data.code !== "200") {
            console.error(`和风 API 业务逻辑错误! Code: ${data.code}, URL: ${fullUrl}`);
            return { code: data.code, error: `HeFeng API business error. Code: ${data.code}` };
        }
        return data;
    } catch (error) {
        console.error(`和风 API 请求 (${fullUrl}) 捕获到错误:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("HeFeng API Error")) {
            return { code: (error as any).code || String((error as any).status) || "UNKNOWN_HFE_ERROR", error: errorMessage };
        }
        return { code: "FETCH_ERROR", error: errorMessage };
    }
}

// 辅助函数：根据城市名称/ID/坐标获取位置信息
// Helper function: Get location information by city name/ID/coordinates.
async function fetchLocationDetails(inputLocation: string): Promise<HeFengLocation | null> {
    if (!HEFENG_GEO_API_URL) {
        console.error("错误：地理位置API基础URL (HEFENG_GEO_API_URL) 未配置。");
        return null;
    }

    console.log(`fetchLocationDetails: 正在为 "${inputLocation}" 查询地理位置信息...`);
    const response = await makeHeFengRequest<HeFengCityLookupResponse>(
        HEFENG_GEO_API_URL,
        "/geo/v2/city/lookup",
        { location: inputLocation } // Use input directly
    );

    if (!response) {
        console.error(`fetchLocationDetails: API请求未能发出或遇到初始配置错误 for "${inputLocation}".`);
        return null;
    }

    if ('error' in response && response.error !== undefined) {
        console.error(`fetchLocationDetails: API调用失败 for "${inputLocation}". Code: ${response.code}, Error: ${response.error}`);
        return null;
    }

    const data = response as HeFengCityLookupResponse;

    if (data.code === "200") {
        if (data.location && data.location.length > 0) {
            console.log(`fetchLocationDetails: 成功获取 "${inputLocation}" 的位置信息: ID ${data.location[0].id}`);
            return data.location[0];
        } else {
            console.error(`fetchLocationDetails: API成功返回 (Code 200) 但未找到 "${inputLocation}" 的位置信息，或数据中缺少location字段。`);
            return null;
        }
    } else {
        console.error(`fetchLocationDetails: API业务逻辑错误 for "${inputLocation}". Code: ${data.code}. Response: ${JSON.stringify(data)}`);
        return null;
    }
}


// 处理工具执行
// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "get_location_id") {
            const { city_name } = LocationIdArgumentsSchema.parse(args);
            if (!HEFENG_GEO_API_URL) {
                 return {
                    content: [{ type: "text", text: "错误：地理位置API基础URL未配置。请管理员使用 --apiUrl 配置。" }],
                };
            }
            const locationDetails = await fetchLocationDetails(city_name);

            if (!locationDetails) {
                const message = `无法找到 "${city_name}" 的位置信息。请确保输入为拼音/英文城市名、有效的LocationID、Adcode或经纬度坐标，并检查API配置。`;
                return {
                    content: [{ type: "text", text: message }],
                };
            }
            const { id, name: locName, lat, lon, adm1, adm2, country } = locationDetails;
            const resultText = `城市: ${locName}\n` +
                               `所属区域: ${adm2 || 'N/A'}, ${adm1 || 'N/A'}, ${country || 'N/A'}\n` +
                               `Location ID: ${id}\n` +
                               `纬度: ${lat}\n` +
                               `经度: ${lon}`;
            return { content: [{ type: "text", text: resultText }] };

        } else if (name === "get_weather") {
            if (!HEFENG_WEATHER_API_URL) {
                 return {
                    content: [{ type: "text", text: "错误：天气API基础URL未配置。请管理员使用 --apiUrl 配置。" }],
                };
            }
            const { location: rawLocationInput, days } = WeatherArgumentsSchema.parse(args);
            const effectiveLocation = rawLocationInput;
            const displayLocation = rawLocationInput;

            console.log(`get_weather: 输入 "${rawLocationInput}" 将直接用于天气查询。`);

            let weatherPath = "";
            if (days === 'now') {
                weatherPath = "/v7/weather/now";
            } else if (['24h', '72h', '168h'].includes(days)) {
                weatherPath = `/v7/weather/${days}`;
            } else {
                weatherPath = `/v7/weather/${days}`;
            }

            console.log(`get_weather: 最终用于天气API的 location 参数: "${effectiveLocation}"`);
            const weatherData = await makeHeFengRequest<HeFengWeatherNowResponse | HeFengWeatherHourlyResponse | HeFengWeatherDailyResponse>(
                HEFENG_WEATHER_API_URL,
                weatherPath,
                { location: effectiveLocation }
            );

            if (!weatherData || ('error' in weatherData) || (weatherData.code && weatherData.code !== "200")) {
                 const apiErrorCode = weatherData?.code || "N/A";
                 const rawErrorMessage = (weatherData as any)?.error || (weatherData as any)?.message || "未能获取数据，请检查地点名称或API配置。";
                 const note = ` (输入 "${rawLocationInput}" 被直接使用查询)`;
                return {
                    content: [{ type: "text", text: `无法获取 ${displayLocation} 的天气数据 (API Code/Status: ${apiErrorCode}). ${rawErrorMessage}${note}` }],
                };
            }

            // Process weather data based on 'days' type (logic remains similar)
            if (days === 'now') {
                if ('now' in weatherData && weatherData.now) {
                    const nowDetails: HeFengNowObject = weatherData.now;
                    const weatherText = `地点: ${displayLocation}\n` +
                        `观测时间: ${nowDetails.obsTime}\n` +
                        `天气: ${nowDetails.text}\n` +
                        `温度: ${nowDetails.temp}°C\n` +
                        `体感温度: ${nowDetails.feelsLike}°C\n` +
                        `风向: ${nowDetails.windDir}\n` +
                        `风力: ${nowDetails.windScale}级\n` +
                        `相对湿度: ${nowDetails.humidity}%\n` +
                        `当前小时累计降水量: ${nowDetails.precip}mm\n` +
                        `大气压强: ${nowDetails.pressure}hPa\n` +
                        `能见度: ${nowDetails.vis}公里`;
                    return { content: [{ type: "text", text: weatherText }] };
                } else {
                    return { content: [{ type: "text", text: `获取 ${displayLocation} 的实时天气数据时，数据结构不完整或无效。 (Code: ${weatherData.code})` }] };
                }
            } else if (['24h', '72h', '168h'].includes(days)) {
                if ('hourly' in weatherData && weatherData.hourly && weatherData.hourly.length > 0) {
                    const hourlyDetails: HeFengHourlyObject[] = weatherData.hourly;
                    const hoursText = hourlyDetails.map(hour => {
                        return `时间: ${hour.fxTime}\n` +
                            `  天气: ${hour.text}, 温度: ${hour.temp}°C\n` +
                            `  湿度: ${hour.humidity}%, 降水概率: ${hour.pop || 'N/A'}%\n` +
                            `  风向: ${hour.windDir} ${hour.windScale}级\n` +
                            `------------------------`;
                    }).join('\n');
                    return {
                        content: [{
                            type: "text",
                            text: `地点: ${displayLocation}\n${days}小时预报:\n${hoursText}`
                        }],
                    };
                } else {
                     return { content: [{ type: "text", text: `无法获取 ${displayLocation} 的逐小时预报，数据不完整或该地区无此项数据。 (Code: ${weatherData.code})` }] };
                }
            } else { 
                if ('daily' in weatherData && weatherData.daily && weatherData.daily.length > 0) {
                    const dailyDetails: HeFengDailyObject[] = weatherData.daily;
                    const forecastText = dailyDetails.map(day => {
                        return `日期: ${day.fxDate} (日出: ${day.sunrise || 'N/A'}, 日落: ${day.sunset || 'N/A'})\n` +
                            `  白天天气: ${day.textDay}, 夜间天气: ${day.textNight}\n` +
                            `  最高温度: ${day.tempMax}°C, 最低温度: ${day.tempMin}°C\n` +
                            `  相对湿度: ${day.humidity}%, 降水量: ${day.precip}mm\n` +
                            `  白天风向: ${day.windDirDay} ${day.windScaleDay}级\n` +
                            `  夜间风向: ${day.windDirNight} ${day.windScaleNight}级\n` +
                            `  紫外线指数: ${day.uvIndex}\n` +
                            `------------------------`;
                    }).join('\n');
                    return {
                        content: [{
                            type: "text",
                            text: `地点: ${displayLocation}\n${days}预报:\n${forecastText}`
                        }],
                    };
                } else {
                    return { content: [{ type: "text", text: `无法获取 ${displayLocation} 的 ${days} 天气预报，数据不完整或该地区无此项数据。 (Code: ${weatherData.code})` }] };
                }
            }
        }
         else {
            throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("参数校验错误:", error.errors);
            const errorMessages = error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ");
            return {
                content: [{ type: "text", text: `输入参数无效: ${errorMessages}` }],
            };
        }
        console.error(`工具 "${name}" 执行出错:`, error);
        return {
            content: [{ type: "text", text: `执行工具 "${name}" 时发生内部错误: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
});

// 启动服务器
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("hefeng-mcp-server MCP Server running on stdio. Waiting for requests...");
}

main().catch((error) => {
    console.error("主程序发生严重错误:", error);
    process.exit(1);
});

