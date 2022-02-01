import {
  IApplicationContext, IConfig,
  IPlugin
} from '@znetstar/attic-common/lib/Server';
import { promises as fs } from 'fs';
import {
    IIdentityEntity as
        IIdentityEntityBase
} from "@znetstar/attic-common/lib/IIdentity";

import {
    IAccessToken
} from "@znetstar/attic-common/lib/IAccessToken";

import { GenericError } from '@znetstar/attic-common/lib/Error/GenericError'
import fetch from "node-fetch";
import {IError} from "@znetstar/attic-common/lib/Error/IError";
import {IIdentity, IRPC, IUser} from "@znetstar/attic-common";
import * as URL from 'url';
import * as _ from 'lodash';
import IClient from "@znetstar/attic-common/lib/IClient";

interface IIdentityEntityModel{
    externalId: string;
    otherFields?: any;
}

type IIdentityEntity = IIdentityEntityModel&IIdentityEntityBase&IIdentity;

export type AtticServerLinkingConfig = IConfig&{
  autoRemoveIdentitiesFromUserUponRelink?: boolean;
  autoRemoveIdentitiesFromUserUponRelinkThenRemoveEntity?: boolean;
}

export type AtticServerLinkingRPCType = IRPC&{
  getLinkedAccountsByClientId(userId: string, clientName?: string[]): Promise<IIdentityEntity[]>;
  removeLinkedAccountsByClientId(userId: string, clientName?: string[], removeIdentityEntity?: boolean): Promise<void>;
  getLinkedAccounts(userId: string, externalId?: string[]): Promise<IIdentityEntity[]>;
  removeLinkedAccounts(userId: string, externalId?: string[], removeIdentityEntity?: boolean): Promise<void>;
};

export type AtticServerLinkingApplicationContext = IApplicationContext&{
  config: AtticServerLinkingConfig;
  rpcServer: { methods: AtticServerLinkingRPCType }
}


export class AtticServerLinking implements IPlugin {
    constructor(public applicationContext: AtticServerLinkingApplicationContext) {

    }

  public async getLinkedAccountsByClientId(userId: string, clientName?: string[]): Promise<IIdentityEntity[]> {
    const user = await (this.applicationContext.mongoose as any).models.User.findById(userId).populate('identities').exec();

    return this.getLinkedAccounts(userId, (clientName ? user.identities.filter((i: IIdentityEntity) => clientName.includes(i.clientName)) : user.identities.slice(0)).map((i: IIdentityEntity) => i.externalId));
  }

  public async removeLinkedAccountsByClientId(userId: string, clientName?: string[], removeIdentityEntity?: boolean): Promise<void> {
    const user = await (this.applicationContext.mongoose as any).models.User.findById(userId).populate('identities').exec();

    return this.removeLinkedAccounts(userId, (clientName ? user.identities.filter((i: IIdentityEntity) => clientName.includes(i.clientName)) : user.identities.slice(0)).map((i: IIdentityEntity) => i.externalId), removeIdentityEntity);
  }

    public async getLinkedAccounts(userId: string, externalId?: string[]): Promise<IIdentityEntity[]> {
      const user = await (this.applicationContext.mongoose as any).models.User.findById(userId).populate('identities').exec();

      return externalId ? user.identities.filter((i: IIdentityEntity) => [].concat(externalId).includes(i.externalId)) : user.identities.slice(0);
    }

    public async removeLinkedAccounts(userId: string, externalId?: string[], removeIdentityEntity?: boolean): Promise<void> {
      const user = await (this.applicationContext.mongoose as any).models.User.findById(userId).populate('identities').exec();

      for (let n of  externalId ? user.identities.map((i: IIdentityEntity, n: number) => [].concat(externalId).includes(i.externalId) ? n : -1).filter((n: number) => n !== -1) : user.identities.map((a: any,i: number) => i)) {
        const entity = user.identities.splice(n, 1)[0] as IIdentityEntity&{remove: () => Promise<void> };
        if (removeIdentityEntity)
          await entity.remove();
      }

      await user.save();
    }

    public async init(): Promise<void> {
        this.applicationContext.registerHook<string|void>(`AuthMiddleware.auth.*.authorize.ignoreIdentityUser`, async (opts: { identity: IIdentityEntity }): Promise<string|void> => {
         if (opts.identity.user && this.applicationContext.config.autoRemoveIdentitiesFromUserUponRelink) {
           // @ts-ignore
           await opts.identity.populate('user').execPopulate()
           await this.removeLinkedAccounts((opts.identity.user as IUser)._id.toString(), opts.identity.externalId, this.applicationContext.config.autoRemoveIdentitiesFromUserUponRelinkThenRemoveEntity);
         }
        });

        this.applicationContext.rpcServer.methods.getLinkedAccountsByClientId = this.getLinkedAccountsByClientId.bind(this);
        this.applicationContext.rpcServer.methods.removeLinkedAccountsByClientId = this.removeLinkedAccountsByClientId.bind(this);
        this.applicationContext.rpcServer.methods.getLinkedAccounts = this.getLinkedAccounts.bind(this);
        this.applicationContext.rpcServer.methods.removeLinkedAccounts = this.removeLinkedAccounts.bind(this);
    }

    public get name(): string {
        return JSON.parse((require('fs').readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8'))).name;
    }
}

export default AtticServerLinking;
